import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authenticate, requirePerm } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { asyncH, ApiError } from '../middleware/error.js';
import { logAudit, clientIp, toNum, round2, nextNumero } from '../lib/utils.js';

const router = Router();
router.use(authenticate);

// GET /api/approvisionnements
router.get('/', requirePerm('approvisionnement', 'read'), asyncH(async (req, res) => {
  const { page = 1, pageSize = 20, from, to, fournisseurId, q } = req.query;
  const where = {};
  if (from || to) where.date = {};
  if (from) where.date.gte = new Date(from);
  if (to) { const d = new Date(to); d.setHours(23, 59, 59, 999); where.date.lte = d; }
  if (fournisseurId) where.fournisseurId = parseInt(fournisseurId, 10);
  if (q) where.OR = [{ numero: { contains: q } }, { fournisseur: { nom: { contains: q } } }];
  const total = await prisma.approvisionnement.count({ where });
  const p = Math.max(1, parseInt(page, 10));
  const ps = Math.min(100, Math.max(5, parseInt(pageSize, 10)));
  const items = await prisma.approvisionnement.findMany({
    where,
    include: {
      fournisseur: { select: { id: true, nom: true } },
      user: { select: { id: true, nom: true, prenom: true, username: true } },
      _count: { select: { items: true } },
    },
    orderBy: { date: 'desc' },
    skip: (p - 1) * ps, take: ps,
  });
  res.json({
    total, page: p, pageSize: ps,
    items: items.map((a) => ({
      ...a,
      totalAchat: toNum(a.totalAchat), totalVente: toNum(a.totalVente), margePotentielle: toNum(a.margePotentielle),
      nbItems: a._count.items,
    })),
  });
}));

// GET /api/approvisionnements/:id
router.get('/:id', requirePerm('approvisionnement', 'read'), asyncH(async (req, res) => {
  const a = await prisma.approvisionnement.findUnique({
    where: { id: parseInt(req.params.id, 10) },
    include: {
      fournisseur: true,
      user: { select: { id: true, nom: true, prenom: true, username: true } },
      items: { include: { medicament: { select: { id: true, code: true, nom: true, emballage: true } } } },
    },
  });
  if (!a) throw new ApiError(404, 'Approvisionnement introuvable');
  res.json({
    ...a,
    totalAchat: toNum(a.totalAchat), totalVente: toNum(a.totalVente), margePotentielle: toNum(a.margePotentielle),
    items: a.items.map((i) => ({
      ...i, prixAchat: toNum(i.prixAchat), prixVente: toNum(i.prixVente),
      valeurAchat: toNum(i.valeurAchat), valeurVente: toNum(i.valeurVente),
    })),
  });
}));

const itemSchema = z.object({
  medicamentId: z.number().int().optional().nullable(),
  // nouveau produit possible directement dans l'approvisionnement
  code: z.string().min(1).max(32).optional(),
  nom: z.string().min(1).max(200).optional(),
  emballage: z.string().max(32).optional().nullable(),
  quantite: z.number().int().positive(),
  prixAchat: z.number().min(0),
  prixVente: z.number().min(0),
  numLot: z.string().max(64).optional().nullable(),
  dateExpiration: z.string().optional().nullable(),
  stockMinimal: z.number().int().min(0).optional(),
  fournisseurId: z.number().int().optional().nullable(),
});

const createSchema = z.object({
  fournisseurId: z.number().int().optional().nullable(),
  date: z.string().optional(),
  notes: z.string().max(500).optional().nullable(),
  items: z.array(itemSchema).min(1, 'Au moins un produit est requis'),
});

// POST /api/approvisionnements — création (stock augmenté automatiquement, transactionnel)
router.post('/', requirePerm('approvisionnement', 'full'), validate(createSchema), asyncH(async (req, res) => {
  const d = req.validated;
  const date = d.date ? new Date(d.date) : new Date();

  const result = await prisma.$transaction(async (tx) => {
    const numero = await nextNumero(tx, 'approvisionnement', 'APPR');
    let totalAchat = 0, totalVente = 0;
    const prepared = [];

    for (const it of d.items) {
      let med;
      if (it.medicamentId) {
        med = await tx.medicament.findUnique({ where: { id: it.medicamentId } });
        if (!med) throw new ApiError(404, `Médicament #${it.medicamentId} introuvable`);
      } else {
        if (!it.code || !it.nom) throw new ApiError(400, 'Code et nom requis pour un nouveau produit');
        const exists = await tx.medicament.findUnique({ where: { code: it.code } });
        if (exists) {
          med = exists;
        } else {
          med = await tx.medicament.create({
            data: {
              code: it.code, nom: it.nom, designation: it.nom, emballage: it.emballage || null,
              prixAchat: it.prixAchat, prixVente: it.prixVente,
              stockMinimal: it.stockMinimal ?? 5, stock: 0,
              fournisseurId: it.fournisseurId ?? d.fournisseurId ?? null,
            },
          });
        }
      }
      const valeurAchat = round2(it.quantite * it.prixAchat);
      const valeurVente = round2(it.quantite * it.prixVente);
      totalAchat += valeurAchat; totalVente += valeurVente;
      prepared.push({ it, med, valeurAchat, valeurVente });
    }

    const appro = await tx.approvisionnement.create({
      data: {
        numero, fournisseurId: d.fournisseurId || null, userId: req.user.id, date,
        totalAchat: round2(totalAchat), totalVente: round2(totalVente),
        margePotentielle: round2(totalVente - totalAchat),
        notes: d.notes || null,
      },
    });

    for (const { it, med, valeurAchat, valeurVente } of prepared) {
      const stockAvant = toNum(med.stock);
      const stockApres = stockAvant + it.quantite;
      await tx.approvisionnementItem.create({
        data: {
          approvisionnementId: appro.id, medicamentId: med.id, quantite: it.quantite,
          prixAchat: it.prixAchat, prixVente: it.prixVente,
          valeurAchat, valeurVente,
          numLot: it.numLot || null,
          dateExpiration: it.dateExpiration ? new Date(it.dateExpiration) : null,
          quantiteRestante: it.dateExpiration ? it.quantite : 0,
        },
      });
      await tx.medicament.update({
        where: { id: med.id },
        data: {
          stock: stockApres,
          prixAchat: it.prixAchat,
          prixVente: it.prixVente,
          ...(it.stockMinimal !== undefined ? { stockMinimal: it.stockMinimal } : {}),
        },
      });
      await tx.stockMovement.create({
        data: {
          medicamentId: med.id, type: 'APPROVISIONNEMENT', quantite: it.quantite,
          stockAvant, stockApres, reference: numero,
          motif: it.numLot ? `Lot ${it.numLot}` : 'Approvisionnement',
          userId: req.user.id,
        },
      });
    }

    await tx.financialTransaction.create({
      data: {
        type: 'ACHAT', montant: round2(totalAchat), sens: 'SORTIE', date,
        reference: numero, description: `Approvisionnement ${numero}`,
      },
    });

    return appro;
  });

  await logAudit(prisma, {
    user: req.user, action: 'CREATE_APPROVISIONNEMENT', module: 'approvisionnement', ip: clientIp(req),
    description: `Approvisionnement ${result.numero} — ${d.items.length} produit(s), total ${round2(toNum(result.totalAchat))} CDF`,
    nouvelleValeur: { numero: result.numero, items: d.items.length },
  });
  res.status(201).json(result);
}));

// POST /api/approvisionnements/:id/annuler — annulation (stock restauré)
router.post('/:id/annuler', requirePerm('approvisionnement', 'full'), asyncH(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const appro = await prisma.approvisionnement.findUnique({ where: { id }, include: { items: true } });
  if (!appro) throw new ApiError(404, 'Approvisionnement introuvable');
  if (appro.statut === 'ANNULE') throw new ApiError(400, 'Déjà annulé');

  await prisma.$transaction(async (tx) => {
    for (const it of appro.items) {
      const med = await tx.medicament.findUnique({ where: { id: it.medicamentId } });
      const stockAvant = toNum(med.stock);
      const stockApres = Math.max(0, stockAvant - it.quantite);
      await tx.medicament.update({ where: { id: med.id }, data: { stock: stockApres } });
      await tx.stockMovement.create({
        data: {
          medicamentId: med.id, type: 'AJUSTEMENT_MANUEL', quantite: -(it.quantite),
          stockAvant, stockApres, reference: appro.numero,
          motif: `Annulation approvisionnement ${appro.numero}`, userId: req.user.id,
        },
      });
      await tx.approvisionnementItem.updateMany({ where: { approvisionnementId: id }, data: { quantiteRestante: 0 } });
    }
    await tx.approvisionnement.update({ where: { id }, data: { statut: 'ANNULE' } });
    await tx.financialTransaction.create({
      data: {
        type: 'AUTRE', montant: toNum(appro.totalAchat), sens: 'ENTREE', date: new Date(),
        reference: appro.numero, description: `Annulation approvisionnement ${appro.numero}`,
      },
    });
  });

  await logAudit(prisma, {
    user: req.user, action: 'ANNULER_APPROVISIONNEMENT', module: 'approvisionnement', ip: clientIp(req),
    description: `Annulation de l'approvisionnement ${appro.numero}`,
  });
  res.json({ ok: true, message: 'Approvisionnement annulé, stock restauré' });
}));

export default router;
