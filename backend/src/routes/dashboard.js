import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { authenticate } from '../middleware/auth.js';
import { asyncH } from '../middleware/error.js';
import { toNum, round2, startOfDay, addDays, endOfDay } from '../lib/utils.js';
import {
  parseRange, getSettings, expirationMap, enrichMedicament, dailySeries,
  topProduitsVendus, topProduitsAchete, listeReapprovisionnement, computeAlertes,
} from '../lib/stats.js';

const router = Router();
router.use(authenticate);

// GET /api/dashboard — tableau de bord (contenu selon rôle)
router.get('/', asyncH(async (req, res) => {
  const { from, to } = parseRange(req.query);
  const settings = await getSettings();
  const today = startOfDay();

  const [meds, ventesToday, ventesPeriod, ventesAgg, approsPeriod, approsCount, depenses] = await Promise.all([
    prisma.medicament.findMany({ where: { actif: true } }),
    prisma.vente.findMany({ where: { date: { gte: today, lte: endOfDay() }, statut: 'VALIDEE' }, select: { total: true } }),
    prisma.vente.findMany({ where: { date: { gte: from, lte: to }, statut: 'VALIDEE' }, select: { total: true, montantRecu: true } }),
    prisma.vente.aggregate({ where: { statut: 'VALIDEE' }, _sum: { total: true }, _count: true }),
    prisma.approvisionnement.aggregate({ where: { date: { gte: from, lte: to }, statut: 'VALIDE' }, _sum: { totalAchat: true }, _count: true }),
    prisma.approvisionnement.count(),
    prisma.financialTransaction.aggregate({ where: { type: 'DEPENSE' }, _sum: { montant: true } }),
  ]);

  const expMap = await expirationMap();
  const enriched = meds.map((m) => enrichMedicament(m, expMap, settings.expSeuils));
  const seuilCourt = settings.expSeuils[settings.expSeuils.length - 1] || 30;
  const valeurStock = round2(enriched.reduce((s, m) => s + m.valeurStockAchat, 0));
  const valeurStockVente = round2(enriched.reduce((s, m) => s + m.valeurStockVente, 0));

  const caToday = round2(ventesToday.reduce((s, v) => s + toNum(v.total), 0));
  const caPeriod = round2(ventesPeriod.reduce((s, v) => s + toNum(v.total), 0));
  const paiementsPeriod = round2(ventesPeriod.reduce((s, v) => s + toNum(v.montantRecu), 0));

  const series = await dailySeries(from, to);
  const [topVendus, flopVendus, topAchete, flopAchete] = await Promise.all([
    topProduitsVendus(from, to, 'top', 5),
    topProduitsVendus(from, to, 'flop', 5),
    topProduitsAchete(from, to, 'top', 5),
    topProduitsAchete(from, to, 'flop', 5),
  ]);
  const reappro = await listeReapprovisionnement(settings);
  const alertes = await computeAlertes(settings);

  // marge sur période
  const itemsPeriod = await prisma.venteItem.findMany({
    where: { vente: { date: { gte: from, lte: to }, statut: 'VALIDEE' } },
    select: { quantite: true, sousTotal: true, medicament: { select: { prixAchat: true } } },
  });
  const coutPeriod = itemsPeriod.reduce((s, i) => s + toNum(i.quantite) * toNum(i.medicament?.prixAchat), 0);
  const margePeriod = round2(caPeriod - coutPeriod);

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
      nbVentesJour: ventesToday.length,
      nbVentes: ventesPeriod.length,
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
