import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authenticate, requirePerm } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { asyncH, ApiError } from '../middleware/error.js';
import { logAudit, clientIp, toNum, round2 } from '../lib/utils.js';
import { expirationMap, enrichMedicament, getSettings } from '../lib/stats.js';

const router = Router();
router.use(authenticate);

// GET /api/medicaments — liste avec recherche, filtres, tri, pagination
router.get('/', requirePerm('medicaments', 'read'), asyncH(async (req, res) => {
  const { q, statut, categorieId, fournisseurId, page = 1, pageSize = 25, sortBy = 'nom', sortDir = 'asc', includeArchived } = req.query;
  const settings = await getSettings();
  const where = {};
  if (!includeArchived) where.actif = true;
  if (q) {
    where.OR = [
      { code: { contains: q } },
      { nom: { contains: q } },
      { designation: { contains: q } },
      { emballage: { contains: q } },
    ];
  }
  if (categorieId) where.categorieId = parseInt(categorieId, 10);
  if (fournisseurId) where.fournisseurId = parseInt(fournisseurId, 10);

  const total = await prisma.medicament.count({ where });
  let rows = await prisma.medicament.findMany({
    where,
    include: { categorie: true, fournisseur: { select: { id: true, nom: true } } },
    orderBy: { [sortBy]: sortDir === 'desc' ? 'desc' : 'asc' },
  });
  const expMap = await expirationMap();
  rows = rows.map((m) => enrichMedicament(m, expMap, settings.expSeuils));
  if (statut && statut !== 'TOUS') rows = rows.filter((m) => m.statut === statut);

  const p = Math.max(1, parseInt(page, 10));
  const ps = Math.min(200, Math.max(5, parseInt(pageSize, 10)));
  const paged = rows.slice((p - 1) * ps, p * ps);
  res.json({ total: rows.length, page: p, pageSize: ps, count: total, items: paged });
}));

// GET /api/medicaments/search — recherche instantanée (typeahead)
router.get('/search', requirePerm('medicaments', 'read'), asyncH(async (req, res) => {
  const q = (req.query.q || '').trim();
  if (q.length < 1) return res.json([]);
  const meds = await prisma.medicament.findMany({
    where: {
      actif: true,
      OR: [
        { code: { contains: q } },
        { nom: { contains: q } },
        { designation: { contains: q } },
        { emballage: { contains: q } },
      ],
    },
    take: 12,
    orderBy: [{ nom: 'asc' }],
  });
  const expMap = await expirationMap();
  const settings = await getSettings();
  res.json(meds.map((m) => enrichMedicament(m, expMap, settings.expSeuils)));
}));

// GET /api/medicaments/:id
router.get('/:id', requirePerm('medicaments', 'read'), asyncH(async (req, res) => {
  const med = await prisma.medicament.findUnique({
    where: { id: parseInt(req.params.id, 10) },
    include: { categorie: true, fournisseur: true },
  });
  if (!med) throw new ApiError(404, 'Médicament introuvable');
  const expMap = await expirationMap();
  const settings = await getSettings();
  res.json(enrichMedicament(med, expMap, settings.expSeuils));
}));

const medSchema = z.object({
  code: z.string().min(1).max(32),
  nom: z.string().min(1).max(200),
  designation: z.string().max(300).optional().nullable(),
  emballage: z.string().max(32).optional().nullable(),
  dateExpiration: z.string().optional().nullable(),
  quantite: z.number().int().min(0).optional().default(0),
  prixAchat: z.number().min(0).optional().default(0),
  prixVente: z.number().min(0).optional().default(0),
  stockMinimal: z.number().int().min(0).optional().default(5),
  fournisseurId: z.number().int().optional().nullable(),
  categorieId: z.number().int().optional().nullable(),
  numLot: z.string().max(64).optional().nullable(),
  dateApprovisionnement: z.string().optional().nullable(),
});

// POST /api/medicaments — ajout d'un médicament (avec stock initial éventuel)
router.post('/', requirePerm('medicaments', 'full'), validate(medSchema), asyncH(async (req, res) => {
  const d = req.validated;
  const exists = await prisma.medicament.findUnique({ where: { code: d.code } });
  if (exists) throw new ApiError(409, `Le code ${d.code} existe déjà (${exists.nom})`);

  const med = await prisma.$transaction(async (tx) => {
    const created = await tx.medicament.create({
      data: {
        code: d.code, nom: d.nom, designation: d.designation || d.nom,
        emballage: d.emballage, prixAchat: d.prixAchat, prixVente: d.prixVente,
        stockMinimal: d.stockMinimal, stock: d.quantite || 0,
        version: 1, deletedAt: null,
        fournisseurId: d.fournisseurId || null, categorieId: d.categorieId || null,
      },
    });
    if (d.quantite > 0) {
      await tx.stockMovement.create({
        data: {
          medicamentId: created.id, type: 'AJUSTEMENT_MANUEL', quantite: d.quantite,
          stockAvant: 0, stockApres: d.quantite, reference: 'INIT',
          motif: 'Stock initial à la création', userId: req.user.id,
        },
      });
      if (d.dateExpiration) {
        await tx.approvisionnementItem.create({
          data: {
            approvisionnementId: null, medicamentId: created.id, quantite: d.quantite,
            prixAchat: d.prixAchat, prixVente: d.prixVente,
            valeurAchat: round2(d.quantite * d.prixAchat), valeurVente: round2(d.quantite * d.prixVente),
            numLot: d.numLot, dateExpiration: new Date(d.dateExpiration), quantiteRestante: d.quantite,
          },
        });
      }
    }
    return created;
  });

  await logAudit(prisma, {
    user: req.user, action: 'CREATE_MEDICAMENT', module: 'medicaments', ip: clientIp(req),
    description: `Création du médicament ${med.code} — ${med.nom}`, nouvelleValeur: d,
  });
  res.status(201).json(med);
}));

// PUT /api/medicaments/:id — modification (ADMIN uniquement ; prix protégés pour assistant)
router.put('/:id', requirePerm('medicaments', 'full'), validate(medSchema.partial()), asyncH(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const med = await prisma.medicament.findUnique({ where: { id } });
  if (!med) throw new ApiError(404, 'Médicament introuvable');
  const d = req.validated;
  if (d.code && d.code !== med.code) {
    const exists = await prisma.medicament.findUnique({ where: { code: d.code } });
    if (exists) throw new ApiError(409, 'Ce code est déjà utilisé');
  }
  const avant = { nom: med.nom, prixAchat: toNum(med.prixAchat), prixVente: toNum(med.prixVente), stockMinimal: med.stockMinimal, emballage: med.emballage };
  const updated = await prisma.medicament.update({
    where: { id },
    data: {
      code: d.code ?? med.code,
      nom: d.nom ?? med.nom,
      designation: d.designation !== undefined ? d.designation : med.designation,
      emballage: d.emballage !== undefined ? d.emballage : med.emballage,
      prixAchat: d.prixAchat ?? toNum(med.prixAchat),
      prixVente: d.prixVente ?? toNum(med.prixVente),
      stockMinimal: d.stockMinimal ?? med.stockMinimal,
      version: { increment: 1 },
      deletedAt: null,
      fournisseurId: d.fournisseurId !== undefined ? d.fournisseurId : med.fournisseurId,
      categorieId: d.categorieId !== undefined ? d.categorieId : med.categorieId,
    },
  });
  await logAudit(prisma, {
    user: req.user, action: 'UPDATE_MEDICAMENT', module: 'medicaments', ip: clientIp(req),
    description: `Modification du médicament ${updated.code} — ${updated.nom}`,
    ancienneValeur: avant, nouvelleValeur: d,
  });
  res.json(updated);
}));

// POST /api/medicaments/:id/archive — archivage (préféré à la suppression)
router.post('/:id/archive', requirePerm('medicaments', 'full'), asyncH(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const med = await prisma.medicament.findUnique({ where: { id }, include: { _count: { select: { venteItems: true } } } });
  if (!med) throw new ApiError(404, 'Médicament introuvable');
  await prisma.medicament.update({ where: { id }, data: { actif: false, deletedAt: new Date(), version: { increment: 1 } } });
  await logAudit(prisma, {
    user: req.user, action: 'ARCHIVE_MEDICAMENT', module: 'medicaments', ip: clientIp(req),
    description: `Archivage du médicament ${med.code} — ${med.nom}`,
  });
  res.json({ ok: true, message: 'Médicament archivé (historique conservé)' });
}));

// DELETE /api/medicaments/:id — suppression physique seulement si aucun historique
router.delete('/:id', requirePerm('medicaments', 'full'), asyncH(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const med = await prisma.medicament.findUnique({
    where: { id },
    include: { _count: { select: { venteItems: true, approvisionnementItems: true, stockMovements: true, inventaireItems: true } } },
  });
  if (!med) throw new ApiError(404, 'Médicament introuvable');
  const c = med._count;
  if (c.venteItems + c.approvisionnementItems + c.inventaireItems > 0) {
    throw new ApiError(400, 'Suppression impossible : ce produit possède un historique comptable. Utilisez l\'archivage.');
  }
  await prisma.stockMovement.deleteMany({ where: { medicamentId: id } });
  await prisma.medicament.delete({ where: { id } });
  await logAudit(prisma, {
    user: req.user, action: 'DELETE_MEDICAMENT', module: 'medicaments', ip: clientIp(req),
    description: `Suppression du médicament ${med.code} — ${med.nom}`,
  });
  res.json({ ok: true, message: 'Médicament supprimé' });
}));

export default router;
