import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authenticate, requirePerm } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { asyncH, ApiError } from '../middleware/error.js';
import { logAudit, clientIp, toNum, round2, nextNumero, MODES_PAIEMENT } from '../lib/utils.js';

const router = Router();
router.use(authenticate);

const includeVente = {
  items: true,
  user: { select: { id: true, nom: true, prenom: true, username: true } },
};

function serializeVente(v) {
  if (!v) return v;
  return {
    ...v,
    total: toNum(v.total),
    remise: toNum(v.remise),
    montantRecu: toNum(v.montantRecu),
    items: (v.items || []).map((i) => ({
      ...i,
      prixUnitaire: toNum(i.prixUnitaire),
      sousTotal: toNum(i.sousTotal),
    })),
  };
}

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
    items: items.map((v) => ({
      ...v,
      total: toNum(v.total),
      remise: toNum(v.remise),
      montantRecu: toNum(v.montantRecu),
      nbItems: v._count.items,
    })),
  });
}));

// GET /api/ventes/:id — détail facture
router.get('/:id', requirePerm('facturation', 'read'), asyncH(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) throw new ApiError(400, 'Identifiant de facture invalide');
  const v = await prisma.vente.findUnique({
    where: { id },
    include: {
      user: { select: { id: true, nom: true, prenom: true, username: true } },
      client: true,
      items: { include: { medicament: { select: { code: true } } } },
    },
  });
  if (!v) throw new ApiError(404, 'Facture introuvable');
  res.json(serializeVente(v));
}));

const saleSchema = z.object({
  // UUID generated on the device. It is the idempotency key and never changes
  // when the operation moves from the offline queue to the server.
  syncId: z.string().uuid().optional(),
  date: z.string().datetime({ offset: true }).optional(),
  items: z.array(z.object({
    medicamentId: z.number().int(),
    quantite: z.number().int().positive(),
    // An offline invoice carries the price snapshot selected locally. The
    // server stores that snapshot instead of silently replacing it with a new
    // catalogue price. Online non-admin callers still cannot override prices.
    prixUnitaire: z.number().min(0).optional(),
  })).min(1, 'Le panier est vide'),
  modePaiement: z.enum(MODES_PAIEMENT).default('ESPECES'),
  remise: z.number().min(0).optional().default(0),
  montantRecu: z.number().min(0).optional(),
  clientId: z.number().int().optional().nullable(),
  notes: z.string().max(300).optional().nullable(),
});

async function existingBySyncId(syncId) {
  if (!syncId) return null;
  return prisma.vente.findUnique({ where: { syncId }, include: includeVente });
}

// POST /api/ventes — validation de la vente : déduction transactionnelle du stock
router.post('/', requirePerm('facturation', 'full'), validate(saleSchema), asyncH(async (req, res) => {
  const d = req.validated;

  // A retry after a timeout may arrive after the first transaction committed.
  // Returning the original resource is what makes the operation idempotent.
  const alreadyCreated = await existingBySyncId(d.syncId);
  if (alreadyCreated) return res.status(200).json(serializeVente(alreadyCreated));

  const priceConflicts = [];
  let outcome;
  try {
    outcome = await prisma.$transaction(async (tx) => {
      const raceWinner = d.syncId
        ? await tx.vente.findUnique({ where: { syncId: d.syncId }, include: includeVente })
        : null;
      if (raceWinner) return { vente: raceWinner, duplicate: true };

      let total = 0;
      const lines = [];
      const byMed = new Map();
      const medications = new Map();

      for (const it of d.items) {
        byMed.set(it.medicamentId, (byMed.get(it.medicamentId) || 0) + it.quantite);
        if (!medications.has(it.medicamentId)) {
          const med = await tx.medicament.findUnique({ where: { id: it.medicamentId } });
          if (!med) throw new ApiError(404, `Médicament #${it.medicamentId} introuvable`);
          if (!med.actif) throw new ApiError(400, `Le produit ${med.nom} est archivé`);
          medications.set(it.medicamentId, med);
        }
      }

      for (const [medicamentId, quantity] of byMed.entries()) {
        const med = medications.get(medicamentId);
        if (toNum(med.stock) < quantity) {
          throw new ApiError(409, `Stock insuffisant pour "${med.nom}" (disponible : ${toNum(med.stock)}, demandé : ${quantity})`, {
            type: 'STOCK_CONFLICT', medicamentId, available: toNum(med.stock), requested: quantity,
          });
        }
      }

      for (const it of d.items) {
        const med = medications.get(it.medicamentId);
        const currentPrice = round2(toNum(med.prixVente));
        const hasSnapshot = d.syncId && it.prixUnitaire !== undefined;
        const prix = hasSnapshot
          ? round2(it.prixUnitaire)
          : (it.prixUnitaire !== undefined && req.user.roleId === 'ADMIN' ? round2(it.prixUnitaire) : currentPrice);
        if (hasSnapshot && prix !== currentPrice) {
          priceConflicts.push({
            medicamentId: med.id,
            code: med.code,
            designation: med.nom,
            priceAtCreation: prix,
            currentPrice,
          });
        }
        const sousTotal = round2(it.quantite * prix);
        total += sousTotal;
        lines.push({ med, quantite: it.quantite, prix, sousTotal });
      }

      // The invoice stores the gross line snapshots and the explicit discount;
      // its total is the net amount that was actually paid.
      const remise = round2(d.remise || 0);
      if (remise > total) throw new ApiError(400, 'La remise ne peut pas dépasser le total de la vente');
      total = round2(total - remise);

      const created = await tx.vente.create({
        data: {
          syncId: d.syncId || null,
          userId: req.user.id,
          clientId: d.clientId || null,
          date: d.date ? new Date(d.date) : new Date(),
          total: round2(total),
          remise,
          montantRecu: d.modePaiement === 'CREDIT' ? 0 : round2(d.montantRecu ?? total),
          modePaiement: d.modePaiement,
          syncConflict: priceConflicts.length ? JSON.stringify({ type: 'PRICE_CHANGED', items: priceConflicts }) : null,
        },
      });

      // stockCursor makes repeated lines for one medicine transactionally
      // correct, while each invoice line still keeps its own price snapshot.
      const stockCursor = new Map([...medications.entries()].map(([id, med]) => [id, toNum(med.stock)]));
      for (const [lineIndex, line] of lines.entries()) {
        const { med, quantite, prix, sousTotal } = line;
        await tx.venteItem.create({
          data: {
            venteId: created.id, medicamentId: med.id,
            designation: med.nom, emballage: med.emballage,
            quantite, prixUnitaire: prix, sousTotal,
          },
        });

        const stockAvant = stockCursor.get(med.id);
        const stockApres = stockAvant - quantite;
        stockCursor.set(med.id, stockApres);
        await tx.medicament.update({ where: { id: med.id }, data: { stock: stockApres, version: { increment: 1 } } });

        // déduction du stock + lots FIFO par expiration
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
            syncId: d.syncId ? `${d.syncId}:vente:${lineIndex}` : null,
            medicamentId: med.id, type: 'VENTE', quantite: -quantite,
            stockAvant, stockApres, reference: created.numero,
            motif: 'Vente', userId: req.user.id,
          },
        });
      }

      await tx.financialTransaction.create({
        data: {
          type: 'VENTE', montant: round2(total), sens: 'ENTREE', date: created.date,
          reference: created.numero, description: `Vente ${created.numero}`,
        },
      });

      return { vente: created, duplicate: false };
    });
  } catch (error) {
    // A unique constraint can be the loser of a concurrent duplicate request.
    // Resolve it by the same stable key instead of reporting a false failure.
    if (d.syncId && error?.code === 'P2002') {
      const concurrent = await existingBySyncId(d.syncId);
      if (concurrent) return res.status(200).json(serializeVente(concurrent));
    }
    throw error;
  }

  if (outcome.duplicate) return res.status(200).json(serializeVente(outcome.vente));

  const vente = outcome.vente;
  await logAudit(prisma, {
    user: req.user, action: 'CREATE_VENTE', module: 'facturation', ip: clientIp(req),
    description: `Vente ${vente.numero} — ${d.items.length} ligne(s), total ${round2(toNum(vente.total))} CDF${priceConflicts.length ? ' — prix historique conservé' : ''}`,
    nouvelleValeur: { numero: vente.numero, syncId: d.syncId || null, total: toNum(vente.total), priceConflicts },
  });
  const full = await prisma.vente.findUnique({ where: { id: vente.id }, include: includeVente });
  res.status(201).json(serializeVente(full));
}));

// POST /api/ventes/:id/annuler — annulation (stock restauré)
router.post('/:id/annuler', requirePerm('facturation', 'full'), validate(z.object({
  motif: z.string().min(3, 'Motif requis').max(300),
})), asyncH(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) throw new ApiError(400, 'Identifiant de facture invalide');
  const vente = await prisma.vente.findUnique({ where: { id }, include: { items: true } });
  if (!vente) throw new ApiError(404, 'Facture introuvable');
  if (vente.statut === 'ANNULEE') throw new ApiError(400, 'Cette vente est déjà annulée');
  if (req.user.roleId === 'ASSISTANT') throw new ApiError(403, 'Seul un administrateur peut annuler une vente');

  await prisma.$transaction(async (tx) => {
    for (const it of vente.items) {
      const med = await tx.medicament.findUnique({ where: { id: it.medicamentId } });
      const stockAvant = toNum(med.stock);
      const stockApres = stockAvant + it.quantite;
      await tx.medicament.update({ where: { id: med.id }, data: { stock: stockApres, version: { increment: 1 } } });

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
    await tx.vente.update({ where: { id }, data: { statut: 'ANNULEE', motifAnnulation: req.validated.motif, version: { increment: 1 } } });
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
