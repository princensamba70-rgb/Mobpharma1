import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authenticate, requirePerm } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { asyncH, ApiError } from '../middleware/error.js';
import { logAudit, clientIp, toNum, round2, nextNumero } from '../lib/utils.js';

const router = Router();
router.use(authenticate);

// GET /api/inventaires — historique
router.get('/', requirePerm('inventaire', 'read'), asyncH(async (req, res) => {
  const rows = await prisma.inventaire.findMany({
    include: {
      user: { select: { nom: true, prenom: true, username: true } },
      _count: { select: { items: true } },
    },
    orderBy: { date: 'desc' },
    take: 100,
  });
  res.json(rows.map((i) => ({ ...i, nbItems: i._count.items })));
}));

// GET /api/inventaires/:id
router.get('/:id', requirePerm('inventaire', 'read'), asyncH(async (req, res) => {
  const inv = await prisma.inventaire.findUnique({
    where: { id: parseInt(req.params.id, 10) },
    include: {
      user: { select: { nom: true, prenom: true, username: true } },
      items: { include: { medicament: { select: { code: true, nom: true, emballage: true } } }, orderBy: { id: 'asc' } },
    },
  });
  if (!inv) throw new ApiError(404, 'Inventaire introuvable');
  res.json({
    ...inv,
    items: inv.items.map((i) => ({ ...i, prixUnitaire: toNum(i.prixUnitaire), valeurEcart: toNum(i.valeurEcart) })),
  });
}));

// POST /api/inventaires — créer un inventaire (photo du stock théorique)
router.post('/', requirePerm('inventaire', 'full'), validate(z.object({
  observations: z.string().max(500).optional().nullable(),
  medicamentIds: z.array(z.number().int()).optional(), // optionnel : sous-ensemble
})), asyncH(async (req, res) => {
  const where = { actif: true };
  if (req.validated.medicamentIds?.length) where.id = { in: req.validated.medicamentIds };
  const meds = await prisma.medicament.findMany({ where, orderBy: { nom: 'asc' } });
  if (!meds.length) throw new ApiError(400, 'Aucun médicament à inventorier');

  const inv = await prisma.$transaction(async (tx) => {
    const numero = await nextNumero(tx, 'inventaire', 'INV');
    const created = await tx.inventaire.create({
      data: { numero, userId: req.user.id, observations: req.validated.observations || null, statut: 'EN_COURS' },
    });
    for (const m of meds) {
      await tx.inventaireItem.create({
        data: {
          inventaireId: created.id, medicamentId: m.id,
          stockTheorique: toNum(m.stock), stockPhysique: toNum(m.stock),
          ecart: 0, prixUnitaire: toNum(m.prixAchat), valeurEcart: 0,
        },
      });
    }
    return created;
  });

  await logAudit(prisma, {
    user: req.user, action: 'CREATE_INVENTAIRE', module: 'inventaire', ip: clientIp(req),
    description: `Création inventaire ${inv.numero} (${meds.length} produits)`,
  });
  res.status(201).json(inv);
}));

// PUT /api/inventaires/:id/items/:itemId — saisir le stock physique
router.put('/:id/items/:itemId', requirePerm('inventaire', 'full'), validate(z.object({
  stockPhysique: z.number().int().min(0),
  observation: z.string().max(300).optional().nullable(),
})), asyncH(async (req, res) => {
  const inv = await prisma.inventaire.findUnique({ where: { id: parseInt(req.params.id, 10) } });
  if (!inv) throw new ApiError(404, 'Inventaire introuvable');
  if (inv.statut === 'VALIDE') throw new ApiError(400, 'Inventaire déjà validé — modification impossible');
  const item = await prisma.inventaireItem.findUnique({ where: { id: parseInt(req.params.itemId, 10) } });
  if (!item || item.inventaireId !== inv.id) throw new ApiError(404, 'Ligne introuvable');

  const ecart = req.validated.stockPhysique - item.stockTheorique;
  const updated = await prisma.inventaireItem.update({
    where: { id: item.id },
    data: {
      stockPhysique: req.validated.stockPhysique,
      ecart,
      valeurEcart: round2(ecart * toNum(item.prixUnitaire)),
      observation: req.validated.observation ?? item.observation,
    },
  });
  res.json({ ...updated, prixUnitaire: toNum(updated.prixUnitaire), valeurEcart: toNum(updated.valeurEcart) });
}));

// POST /api/inventaires/:id/valider — application des écarts au stock réel
router.post('/:id/valider', requirePerm('inventaire', 'full'), asyncH(async (req, res) => {
  const inv = await prisma.inventaire.findUnique({
    where: { id: parseInt(req.params.id, 10) }, include: { items: true },
  });
  if (!inv) throw new ApiError(404, 'Inventaire introuvable');
  if (inv.statut === 'VALIDE') throw new ApiError(400, 'Inventaire déjà validé');

  const resume = await prisma.$transaction(async (tx) => {
    let surplus = 0, deficit = 0, manquants = 0, valeurEcartTotale = 0;
    for (const it of inv.items) {
      if (it.ecart === 0) continue;
      const med = await tx.medicament.findUnique({ where: { id: it.medicamentId } });
      const stockAvant = toNum(med.stock);
      // stockPhysique recalculé relativement au stock actuel (des ventes peuvent être survenues)
      const nouveauStock = Math.max(0, stockAvant + it.ecart);
      await tx.medicament.update({ where: { id: med.id }, data: { stock: nouveauStock, version: { increment: 1 } } });
      await tx.stockMovement.create({
        data: {
          medicamentId: med.id, type: 'AJUSTEMENT_INVENTAIRE',
          quantite: nouveauStock - stockAvant, stockAvant, stockApres: nouveauStock,
          reference: inv.numero, motif: `Inventaire physique ${inv.numero}${it.observation ? ' — ' + it.observation : ''}`,
          userId: req.user.id,
        },
      });
      if (it.ecart > 0) surplus++; else deficit++;
      if (it.stockPhysique === 0) manquants++;
      valeurEcartTotale += toNum(it.valeurEcart);
    }
    await tx.inventaire.update({ where: { id: inv.id }, data: { statut: 'VALIDE', valideAt: new Date() } });
    return { surplus, deficit, manquants, valeurEcartTotale: round2(valeurEcartTotale) };
  });

  await logAudit(prisma, {
    user: req.user, action: 'VALIDATE_INVENTAIRE', module: 'inventaire', ip: clientIp(req),
    description: `Validation inventaire ${inv.numero} — surplus: ${resume.surplus}, déficits: ${resume.deficit}, valeur écart: ${resume.valeurEcartTotale} CDF`,
    nouvelleValeur: resume,
  });
  res.json({ ok: true, message: 'Inventaire validé, stock mis à jour', resume });
}));

export default router;
