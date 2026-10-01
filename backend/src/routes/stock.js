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

// GET /api/stock — tableau de gestion de stock temps réel
router.get('/', requirePerm('stock', 'read'), asyncH(async (req, res) => {
  const { q, statut, page = 1, pageSize = 25 } = req.query;
  const settings = await getSettings();
  const where = { actif: true };
  if (q) where.OR = [{ code: { contains: q } }, { nom: { contains: q } }, { designation: { contains: q } }, { emballage: { contains: q } }];
  const meds = await prisma.medicament.findMany({ where, include: { fournisseur: { select: { nom: true } } } });
  const expMap = await expirationMap();
  let rows = meds.map((m) => enrichMedicament(m, expMap, settings.expSeuils));
  if (statut && statut !== 'TOUS') rows = rows.filter((m) => m.statut === statut);
  rows.sort((a, b) => a.nom.localeCompare(b.nom));
  const p = Math.max(1, parseInt(page, 10));
  const ps = Math.min(500, Math.max(5, parseInt(pageSize, 10)));
  res.json({
    total: rows.length, page: p, pageSize: ps,
    items: rows.slice((p - 1) * ps, p * ps),
    resume: {
      normal: rows.filter((r) => r.statut === 'NORMAL').length,
      faible: rows.filter((r) => r.statut === 'FAIBLE').length,
      epuise: rows.filter((r) => r.statut === 'EPUISE').length,
      expirationProche: rows.filter((r) => r.statut === 'EXPIRATION_PROCHE').length,
      expire: rows.filter((r) => r.statut === 'EXPIRE').length,
      valeurStockAchat: round2(rows.reduce((s, r) => s + r.valeurStockAchat, 0)),
      valeurStockVente: round2(rows.reduce((s, r) => s + r.valeurStockVente, 0)),
    },
  });
}));

// GET /api/stock/alertes — alertes stock faible / épuisé
router.get('/alertes', requirePerm('stock', 'read'), asyncH(async (req, res) => {
  const settings = await getSettings();
  const meds = await prisma.medicament.findMany({ where: { actif: true } });
  const expMap = await expirationMap();
  const rows = meds.map((m) => enrichMedicament(m, expMap, settings.expSeuils));
  const faibles = rows.filter((r) => r.statut === 'FAIBLE').map((r) => ({ ...r, alerte: 'STOCK FAIBLE — APPROVISIONNEMENT NÉCESSAIRE' }));
  const epuises = rows.filter((r) => r.statut === 'EPUISE').map((r) => ({ ...r, alerte: 'STOCK ÉPUISÉ' }));
  res.json({ faibles, epuises, countFaibles: faibles.length, countEpuises: epuises.length });
}));

// GET /api/stock/expiration — produits proches de l'expiration
router.get('/expiration', requirePerm('stock', 'read'), asyncH(async (req, res) => {
  const settings = await getSettings();
  const seuilMax = Math.max(...(settings.expSeuils.length ? settings.expSeuils : [180]));
  const meds = await prisma.medicament.findMany({ where: { actif: true } });
  const expMap = await expirationMap();
  const rows = meds
    .map((m) => enrichMedicament(m, expMap, settings.expSeuils))
    .filter((r) => r.joursRestants !== null && r.joursRestants <= seuilMax)
    .map((r) => {
      let niveau = 'EXPIRE';
      for (const s of [...settings.expSeuils].sort((a, b) => a - b)) {
        if (r.joursRestants >= 0 && r.joursRestants <= s) { niveau = `J-${s}`; break; }
      }
      if (r.joursRestants < 0) niveau = 'EXPIRE';
      // valeur du stock concerné (lots expirant)
      return {
        id: r.id, code: r.code, medicament: r.nom, emballage: r.emballage,
        dateExpiration: r.expirationProchaine, joursRestants: r.joursRestants,
        quantite: r.stock, valeurStock: r.valeurStockAchat, niveau,
      };
    })
    .sort((a, b) => a.joursRestants - b.joursRestants);
  res.json({ seuils: settings.expSeuils, items: rows });
}));

// GET /api/stock/mouvements — historique des mouvements
router.get('/mouvements', requirePerm('stock', 'read'), asyncH(async (req, res) => {
  const { medicamentId, page = 1, pageSize = 30, type } = req.query;
  const where = {};
  if (medicamentId) where.medicamentId = parseInt(medicamentId, 10);
  if (type) where.type = type;
  const total = await prisma.stockMovement.count({ where });
  const p = Math.max(1, parseInt(page, 10));
  const ps = Math.min(100, Math.max(5, parseInt(pageSize, 10)));
  const items = await prisma.stockMovement.findMany({
    where,
    include: { medicament: { select: { code: true, nom: true, emballage: true } } },
    orderBy: { createdAt: 'desc' },
    skip: (p - 1) * ps, take: ps,
  });
  res.json({ total, page: p, pageSize: ps, items });
}));

// POST /api/stock/ajustement — ajustement manuel avec motif OBLIGATOIRE
router.post('/ajustement', requirePerm('stock', 'full'), validate(z.object({
  syncId: z.string().uuid().optional(),
  medicamentId: z.number().int(),
  nouveauStock: z.number().int().min(0),
  motif: z.string().min(5, 'Le motif de l\'ajustement est obligatoire (5 caractères min.)').max(300),
})), asyncH(async (req, res) => {
  const { syncId, medicamentId, nouveauStock, motif } = req.validated;

  // The movement UUID is the durable idempotency key for a manual adjustment.
  if (syncId) {
    const alreadyApplied = await prisma.stockMovement.findUnique({ where: { syncId } });
    if (alreadyApplied) return res.json({ ok: true, duplicate: true, message: 'Ajustement déjà enregistré', mouvement: alreadyApplied });
  }

  const med = await prisma.medicament.findUnique({ where: { id: medicamentId } });
  if (!med) throw new ApiError(404, 'Médicament introuvable');

  const result = await prisma.$transaction(async (tx) => {
    if (syncId) {
      const raceWinner = await tx.stockMovement.findUnique({ where: { syncId } });
      if (raceWinner) return raceWinner;
    }
    const stockAvant = toNum(med.stock);
    const delta = nouveauStock - stockAvant;
    if (delta === 0) throw new ApiError(400, 'Le stock est déjà à cette valeur');
    await tx.medicament.update({ where: { id: med.id }, data: { stock: nouveauStock, version: { increment: 1 } } });
    if (delta < 0) {
      // réduire les lots
      let restant = -delta;
      const lots = await tx.approvisionnementItem.findMany({
        where: { medicamentId: med.id, quantiteRestante: { gt: 0 } },
        orderBy: [{ dateExpiration: 'asc' }, { id: 'asc' }],
      });
      for (const lot of lots) {
        if (restant <= 0) break;
        const take = Math.min(restant, lot.quantiteRestante);
        await tx.approvisionnementItem.update({ where: { id: lot.id }, data: { quantiteRestante: lot.quantiteRestante - take } });
        restant -= take;
      }
    }
    const mv = await tx.stockMovement.create({
      data: {
        syncId: syncId || null,
        medicamentId: med.id, type: 'AJUSTEMENT_MANUEL', quantite: delta,
        stockAvant, stockApres: nouveauStock, reference: 'ADJ',
        motif, userId: req.user.id,
      },
    });
    return mv;
  });

  await logAudit(prisma, {
    user: req.user, action: 'AJUSTEMENT_STOCK', module: 'stock', ip: clientIp(req),
    description: `Ajustement stock ${med.code} — ${med.nom} : ${result.stockAvant} → ${result.stockApres} (${motif})`,
    ancienneValeur: { stock: result.stockAvant }, nouvelleValeur: { stock: result.stockApres, motif, syncId: syncId || null },
  });
  res.json({ ok: true, message: 'Stock ajusté', mouvement: result });
}));

export default router;
