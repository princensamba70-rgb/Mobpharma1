import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { authenticate } from '../middleware/auth.js';
import { asyncH } from '../middleware/error.js';
import { toNum, round2, startOfDay, addDays, endOfDay } from '../lib/utils.js';
import {
  parseRange, getSettings, expirationMap, enrichMedicament, dashboardSalesData,
  topProduitsAchetePair, buildReapprovisionnement, computeAlertesFromEnriched,
} from '../lib/stats.js';

const router = Router();
router.use(authenticate);

// GET /api/dashboard — tableau de bord (contenu selon rôle)
router.get('/', asyncH(async (req, res) => {
  const { from, to } = parseRange(req.query);
  const today = startOfDay();
  const dayWhere = { date: { gte: today, lte: endOfDay() }, statut: 'VALIDEE' };
  const periodWhere = { date: { gte: from, lte: to }, statut: 'VALIDEE' };

  // Settings, counters and aggregates are independent. The old route also
  // materialised every sale just to sum totals; aggregates transfer only a
  // handful of values and return much faster on a large pharmacy database.
  const [settings, [meds, ventesToday, ventesPeriod, ventesAgg, approsPeriod, approsCount, depenses]] = await Promise.all([
    getSettings(),
    Promise.all([
      prisma.medicament.findMany({
        where: { actif: true },
        select: {
          id: true, code: true, nom: true, emballage: true, prixAchat: true,
          prixVente: true, stock: true, stockMinimal: true, actif: true,
          fournisseur: { select: { nom: true } },
        },
      }),
      prisma.vente.aggregate({ where: dayWhere, _sum: { total: true }, _count: true }),
      prisma.vente.aggregate({ where: periodWhere, _sum: { total: true, montantRecu: true }, _count: true }),
      prisma.vente.aggregate({ where: { statut: 'VALIDEE' }, _sum: { total: true }, _count: true }),
      prisma.approvisionnement.aggregate({ where: { date: { gte: from, lte: to }, statut: 'VALIDE' }, _sum: { totalAchat: true }, _count: true }),
      prisma.approvisionnement.count(),
      prisma.financialTransaction.aggregate({ where: { type: 'DEPENSE' }, _sum: { montant: true } }),
    ]),
  ]);

  // These read-only datasets are independent too. Fetch them in parallel and
  // reuse the same medication/expiration snapshot below for alerts/reorders.
  const [expMap, salesData, purchasePair] = await Promise.all([
    expirationMap(),
    dashboardSalesData(from, to, 5),
    topProduitsAchetePair(from, to, 5),
  ]);
  const { series, salesPair, coutVentes } = salesData;
  const enriched = meds.map((m) => enrichMedicament(m, expMap, settings.expSeuils));
  const seuilCourt = settings.expSeuils[settings.expSeuils.length - 1] || 30;
  const valeurStock = round2(enriched.reduce((s, m) => s + m.valeurStockAchat, 0));
  const valeurStockVente = round2(enriched.reduce((s, m) => s + m.valeurStockVente, 0));

  const caToday = round2(ventesToday._sum.total || 0);
  const caPeriod = round2(ventesPeriod._sum.total || 0);
  const paiementsPeriod = round2(ventesPeriod._sum.montantRecu || 0);
  const reappro = buildReapprovisionnement(enriched, settings);
  const alertes = computeAlertesFromEnriched(enriched, settings, reappro);
  const topVendus = salesPair.top;
  const flopVendus = salesPair.flop;
  const topAchete = purchasePair.top;
  const flopAchete = purchasePair.flop;
  // Reuse the dashboard item snapshot for cost. Keeping the card formula as
  // before preserves invoice-level discounts (caPeriod - cost) without a
  // second full venteItem query; the chart keeps its item-level margin series.
  const margePeriod = round2(caPeriod - coutVentes);

  res.json({
    role: req.user.roleId,
    periode: { from, to },
    cartes: {
      chiffreAffairesJour: caToday,
      chiffreAffaires: caPeriod,
      valeurStock,
      valeurStockVente,
      nbMedicaments: meds.length,
      stockFaible: alertes.faibles,
      epuises: alertes.epuises,
      expirationProche: alertes.expirationProche,
      expires: alertes.expires,
      nbVentesJour: ventesToday._count,
      nbVentes: ventesPeriod._count,
      nbVentesTotal: ventesAgg._count,
      caTotal: round2(ventesAgg._sum.total || 0),
      nbApprovisionnements: approsPeriod._count,
      nbApprovisionnementsTotal: approsCount,
      depensesApprovisionnement: round2(approsPeriod._sum.totalAchat || 0),
      margeBrute: margePeriod,
      paiementsRecus: paiementsPeriod,
      depenses: round2(toNum(depenses._sum.montant)),
      resultat: round2(margePeriod - toNum(depenses._sum.montant)),
      reapprovisionnement: reappro.length,
    },
    series,
    topVendus, flopVendus, topAchete, flopAchete,
    reappro: reappro.slice(0, 10),
    stockRepartition: {
      normal: enriched.filter((m) => m.statut === 'NORMAL').length,
      faible: enriched.filter((m) => m.statut === 'FAIBLE').length,
      epuise: enriched.filter((m) => m.statut === 'EPUISE').length,
      expirationProche: enriched.filter((m) => m.statut === 'EXPIRATION_PROCHE').length,
      expire: enriched.filter((m) => m.statut === 'EXPIRE').length,
    },
    alertes,
  });
}));

export default router;
