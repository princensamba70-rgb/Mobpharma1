import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authenticate, requirePerm } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { asyncH, ApiError } from '../middleware/error.js';
import { logAudit, clientIp, toNum, round2, nextNumero, MODES_PAIEMENT } from '../lib/utils.js';

const router = Router();
router.use(authenticate);

// GET /api/ventes
router.get('/', requirePerm('facturation', 'read'), asyncH(async (req, res) => {
  const { page = 1, pageSize = 20, from, to, q, statut } = req.query;
  const where = {};
  if (from || to) where.date = {};
  if (from) where.date.gte = new Date(from);
  if (to) { const d = new Date(to); d.setHours(23, 59, 59, 999); where.date.lte = d; }
  if (q) where.OR = [{ numero: { contains: q } }, { user: { username: { contains: q } } }];
  if (statut) where.statut = statut;
  const total = await prisma.vente.count({ where });
  const p = Math.max(1, parseInt(page, 10));
  const ps = Math.min(100, Math.max(5, parseInt(pageSize, 10)));
  const items = await prisma.vente.findMany({
    where,
    include: {
      user: { select: { id: true, nom: true, prenom: true, username: true } },
      _count: { select: { items: true } },
    },
    orderBy: { date: 'desc' },
    skip: (p - 1) * ps, take: ps,
  });
  const sum = await prisma.vente.aggregate({ where, _sum: { total: true } });
  res.json({
    total, page: p, pageSize: ps, totalMontant: round2(sum._sum.total || 0),
    items: items.map((v) => ({ ...v, total: toNum(v.total), montantRecu: toNum(v.montantRecu), nbItems: v._count.items })),
  });
}));

// GET /api/ventes/:id — détail facture
router.get('/:id', requirePerm('facturation', 'read'), asyncH(async (req, res) => {
  const v = await prisma.vente.findUnique({
    where: { id: parseInt(req.params.id, 10) },
    include: {
      user: { select: { id: true, nom: true, prenom: true, username: true } },
      client: true,
      items: { include: { medicament: { select: { code: true } } } },
    },
  });
  if (!v) throw new ApiError(404, 'Facture introuvable');
  res.json({
    ...v, total: toNum(v.total), montantRecu: toNum(v.montantRecu),
    items: v.items.map((i) => ({ ...i, prixUnitaire: toNum(i.prixUnitaire), sousTotal: toNum(i.sousTotal) })),
  });
}));

const saleSchema = z.object({
  items: z.array(z.object({
    medicamentId: z.number().int(),
    quantite: z.number().int().positive(),
    prixUnitaire: z.number().min(0).optional(),
  })).min(1, 'Le panier est vide'),
  modePaiement: z.enum(MODES_PAIEMENT).default('ESPECES'),
  montantRecu: z.number().min(0).optional(),
  clientId: z.number().int().optional().nullable(),
  notes: z.string().max(300).optional().nullable(),
});

// POST /api/ventes — validation de la vente : déduction transactionnelle du stock
router.post('/', requirePerm('facturation', 'full'), validate(saleSchema), asyncH(async (req, res) => {
  const d = req.validated;

  const vente = await prisma.$transaction(async (tx) => {
    const numero = await nextNumero(tx, 'vente', 'FAC');
    let total = 0;
    const lines = [];

    // agrégation des lignes par médicament
    const byMed = {};
    for (const it of d.items) {
      byMed[it.medicamentId] = (byMed[it.medicamentId] || 0) + it.quantite;
    }

    for (const it of d.items) {
      const med = await tx.medicament.findUnique({ where: { id: it.medicamentId } });
      if (!med) throw new ApiError(404, `Médicament #${it.medicamentId} introuvable`);
      if (!med.actif) throw new ApiError(400, `Le produit ${med.nom} est archivé`);
      const prix = it.prixUnitaire !== undefined && req.user.roleId === 'ADMIN' ? it.prixUnitaire : toNum(med.prixVente);
      const sousTotal = round2(it.quantite * prix);
      total += sousTotal;
      lines.push({ med, quantite: it.quantite, prix, sousTotal });
    }

    // contrôle stock global par médicament
    for (const [medId, qty] of Object.entries(byMed)) {
      const med = await tx.medicament.findUnique({ where: { id: parseInt(medId, 10) } });
      if (toNum(med.stock) < qty) {
        throw new ApiError(409, `Stock insuffisant pour "${med.nom}" (disponible : ${toNum(med.stock)}, demandé : ${qty})`);
      }
    }

    const created = await tx.vente.create({
      data: {
        numero, userId: req.user.id, clientId: d.clientId || null,
        total: round2(total),
        montantRecu: d.modePaiement === 'CREDIT' ? 0 : round2(d.montantRecu ?? total),
        modePaiement: d.modePaiement,
      },
    });

    for (const line of lines) {
      const { med, quantite, prix, sousTotal } = line;
      await tx.venteItem.create({
        data: {
          venteId: created.id, medicamentId: med.id,
          designation: med.nom, emballage: med.emballage,
          quantite, prixUnitaire: prix, sousTotal,
        },
      });

      // déduction du stock + lots FIFO par expiration
      const stockAvant = toNum(med.stock);
      const stockApres = stockAvant - quantite;
      await tx.medicament.update({ where: { id: med.id }, data: { stock: stockApres } });

      let restant = quantite;
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

      await tx.stockMovement.create({
        data: {
          medicamentId: med.id, type: 'VENTE', quantite: -quantite,
          stockAvant, stockApres, reference: numero,
          motif: 'Vente', userId: req.user.id,
        },
      });
    }

    await tx.financialTransaction.create({
      data: {
        type: 'VENTE', montant: round2(total), sens: 'ENTREE', date: created.date,
        reference: numero, description: `Vente ${numero}`,
      },
    });

    return created;
  });

  await logAudit(prisma, {
    user: req.user, action: 'CREATE_VENTE', module: 'facturation', ip: clientIp(req),
    description: `Vente ${vente.numero} — ${d.items.length} ligne(s), total ${round2(toNum(vente.total))} CDF`,
    nouvelleValeur: { numero: vente.numero, total: toNum(vente.total) },
  });
  const full = await prisma.vente.findUnique({
    where: { id: vente.id },
    include: { items: true, user: { select: { nom: true, prenom: true, username: true } } },
  });
  res.status(201).json({ ...full, total: toNum(full.total), montantRecu: toNum(full.montantRecu) });
}));

// POST /api/ventes/:id/annuler — annulation (stock restauré)
router.post('/:id/annuler', requirePerm('facturation', 'full'), validate(z.object({
  motif: z.string().min(3, 'Motif requis').max(300),
})), asyncH(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const vente = await prisma.vente.findUnique({ where: { id }, include: { items: true } });
  if (!vente) throw new ApiError(404, 'Facture introuvable');
  if (vente.statut === 'ANNULEE') throw new ApiError(400, 'Cette vente est déjà annulée');
  if (req.user.roleId === 'ASSISTANT') throw new ApiError(403, 'Seul un administrateur peut annuler une vente');

  await prisma.$transaction(async (tx) => {
    for (const it of vente.items) {
      const med = await tx.medicament.findUnique({ where: { id: it.medicamentId } });
      const stockAvant = toNum(med.stock);
      const stockApres = stockAvant + it.quantite;
      await tx.medicament.update({ where: { id: med.id }, data: { stock: stockApres } });

      // restauration dans les lots vendus (les plus entamés d'abord)
      let restant = it.quantite;
      const lots = await tx.approvisionnementItem.findMany({
        where: { medicamentId: med.id, quantite: { gt: 0 } },
        orderBy: [{ dateExpiration: 'asc' }, { id: 'asc' }],
      });
      for (const lot of lots) {
        if (restant <= 0) break;
        const vendus = lot.quantite - lot.quantiteRestante;
        if (vendus <= 0) continue;
        const put = Math.min(restant, vendus);
        await tx.approvisionnementItem.update({ where: { id: lot.id }, data: { quantiteRestante: lot.quantiteRestante + put } });
        restant -= put;
      }

      await tx.stockMovement.create({
        data: {
          medicamentId: med.id, type: 'ANNULATION_VENTE', quantite: it.quantite,
          stockAvant, stockApres, reference: vente.numero,
          motif: `Annulation vente : ${req.validated.motif}`, userId: req.user.id,
        },
      });
    }
    await tx.vente.update({ where: { id }, data: { statut: 'ANNULEE', motifAnnulation: req.validated.motif } });
    await tx.financialTransaction.create({
      data: {
        type: 'AUTRE', montant: toNum(vente.total), sens: 'SORTIE', date: new Date(),
        reference: vente.numero, description: `Annulation vente ${vente.numero} : ${req.validated.motif}`,
      },
    });
  });

  await logAudit(prisma, {
    user: req.user, action: 'ANNULER_VENTE', module: 'facturation', ip: clientIp(req),
    description: `Annulation de la vente ${vente.numero} — motif : ${req.validated.motif}`,
    ancienneValeur: { numero: vente.numero, total: toNum(vente.total) },
  });
  res.json({ ok: true, message: 'Vente annulée, stock restauré' });
}));

export default router;
