import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { authenticate, requirePerm } from '../middleware/auth.js';
import { asyncH } from '../middleware/error.js';
import { toNum, round2, startOfDay, endOfDay, addDays, dayKey } from '../lib/utils.js';
import {
  parseRange, getSettings, expirationMap, enrichMedicament, dailySeries,
  topProduitsVendus, topProduitsAchete, listeReapprovisionnement,
} from '../lib/stats.js';

const router = Router();
router.use(authenticate);

// GET /api/rapports/journalier?date=YYYY-MM-DD (défaut: aujourd'hui) — rapport journalier complet
router.get('/journalier', requirePerm('rapportJournalier', 'read'), asyncH(async (req, res) => {
  const date = req.query.date ? new Date(req.query.date) : new Date();
  const from = startOfDay(date), to = endOfDay(date);
  const settings = await getSettings();

  const [ventes, venteItems, appros] = await Promise.all([
    prisma.vente.findMany({ where: { date: { gte: from, lte: to }, statut: 'VALIDEE' }, include: { items: true } }),
    prisma.venteItem.findMany({
      where: { vente: { date: { gte: from, lte: to }, statut: 'VALIDEE' } },
      include: { medicament: { select: { prixAchat: true } } },
    }),
    prisma.approvisionnement.findMany({ where: { date: { gte: from, lte: to }, statut: 'VALIDE' } }),
  ]);

  const ca = round2(ventes.reduce((s, v) => s + toNum(v.total), 0));
  const paiements = round2(ventes.reduce((s, v) => s + toNum(v.montantRecu), 0));
  const nbProduits = venteItems.reduce((s, i) => s + toNum(i.quantite), 0);
  const coutVentes = venteItems.reduce((s, i) => s + toNum(i.quantite) * toNum(i.medicament?.prixAchat), 0);
  const totalAchats = round2(appros.reduce((s, a) => s + toNum(a.totalAchat), 0));
  const margeBrute = round2(ca - coutVentes);

  // agrégats par produit
  const agg = {};
  for (const i of venteItems) {
    const a = (agg[i.medicamentId] ||= { designation: i.designation, quantite: 0, total: 0 });
    a.quantite += toNum(i.quantite); a.total += toNum(i.sousTotal);
  }
  const produits = Object.values(agg).map((a) => ({ ...a, total: round2(a.total) })).sort((x, y) => y.quantite - x.quantite);

  // état du stock
  const meds = await prisma.medicament.findMany({ where: { actif: true } });
  const expMap = await expirationMap();
  const enriched = meds.map((m) => enrichMedicament(m, expMap, settings.expSeuils));
  const seuilCourt = settings.expSeuils[settings.expSeuils.length - 1] || 30;

  // séries 7 jours pour graphique
  const series = await dailySeries(addDays(from, -6), to);

  // upsert du DailyReport
  await prisma.dailyReport.upsert({
    where: { date: from },
    create: { date: from, nbVentes: ventes.length, nbProduitsVendus: nbProduits, chiffreAffaires: ca, totalAchats, margeBrute, paiementsRecus: paiements },
    update: { nbVentes: ventes.length, nbProduitsVendus: nbProduits, chiffreAffaires: ca, totalAchats, margeBrute, paiementsRecus: paiements, genereAt: new Date() },
  });

  res.json({
    date: dayKey(from),
    nbVentes: ventes.length,
    nbProduitsVendus: nbProduits,
    chiffreAffaires: ca,
    totalAchats,
    margeBrute,
    paiementsRecus: paiements,
    coutVentes: round2(coutVentes),
    plusVendus: produits.slice(0, 5),
    moinsVendus: produits.length ? [...produits].reverse().slice(0, 5) : [],
    ruptures: enriched.filter((m) => m.statut === 'EPUISE').map((m) => ({ code: m.code, nom: m.nom, stockMinimal: m.stockMinimal })),
    stockFaible: enriched.filter((m) => m.statut === 'FAIBLE').map((m) => ({ code: m.code, nom: m.nom, stock: m.stock, stockMinimal: m.stockMinimal })),
    expirationProche: enriched
      .filter((m) => m.joursRestants !== null && m.joursRestants >= 0 && m.joursRestants <= seuilCourt)
      .map((m) => ({ code: m.code, nom: m.nom, expiration: m.expirationProchaine, joursRestants: m.joursRestants })),
    ventesDetail: ventes.map((v) => ({ numero: v.numero, heure: v.date, total: toNum(v.total), mode: v.modePaiement, nbItems: v.items.length })),
    series7j: series,
  });
}));

// GET /api/rapports/approvisionnement — rapport automatique de réapprovisionnement
router.get('/approvisionnement', requirePerm('rapports', 'read'), asyncH(async (req, res) => {
  const settings = await getSettings();
  const list = await listeReapprovisionnement(settings);
  res.json({
    genereLe: new Date(),
    facteurCible: settings.reapproFacteur,
    items: list,
    resume: {
      total: list.length,
      urgent: list.filter((i) => i.priorite === 'URGENT').length,
      eleve: list.filter((i) => i.priorite === 'ELEVE').length,
      normal: list.filter((i) => i.priorite === 'NORMAL').length,
      valeurEstimee: round2(list.reduce((s, i) => s + i.valeurEstimee, 0)),
    },
  });
}));

// GET /api/rapports/financier?from&to ou period — rapport financier complet
router.get('/financier', requirePerm('finance', 'read'), asyncH(async (req, res) => {
  const { from, to } = parseRange(req.query);
  const series = await dailySeries(from, to);

  const [ventesAgg, approsAgg, depenses] = await Promise.all([
    prisma.vente.aggregate({ where: { date: { gte: from, lte: to }, statut: 'VALIDEE' }, _sum: { total: true, montantRecu: true }, _count: true }),
    prisma.approvisionnement.aggregate({ where: { date: { gte: from, lte: to }, statut: 'VALIDE' }, _sum: { totalAchat: true }, _count: true }),
    prisma.financialTransaction.aggregate({ where: { date: { gte: from, lte: to }, type: 'DEPENSE' }, _sum: { montant: true } }),
  ]);

  const coutVentes = await prisma.venteItem.findMany({
    where: { vente: { date: { gte: from, lte: to }, statut: 'VALIDEE' } },
    select: { quantite: true, medicament: { select: { prixAchat: true } } },
  });
  const cout = coutVentes.reduce((s, i) => s + toNum(i.quantite) * toNum(i.medicament?.prixAchat), 0);

  const meds = await prisma.medicament.findMany({ where: { actif: true } });
  const valeurStock = round2(meds.reduce((s, m) => s + toNum(m.stock) * toNum(m.prixAchat), 0));

  const ca = round2(ventesAgg._sum.total || 0);
  const achats = round2(approsAgg._sum.totalAchat || 0);
  const dep = round2(depenses._sum.montant || 0);
  const marge = round2(ca - cout);
  const resultat = round2(marge - dep);
  const creances = round2(await (async () => {
    const c = await prisma.vente.aggregate({ where: { date: { gte: from, lte: to }, statut: 'VALIDEE', modePaiement: 'CREDIT' }, _sum: { total: true, montantRecu: true } });
    return toNum(c._sum.total) - toNum(c._sum.montantRecu);
  })());

  res.json({
    periode: { from, to },
    chiffreAffaires: ca,
    totalAchats: achats,
    coutVentes: round2(cout),
    margeBrute: marge,
    depenses: dep,
    resultat,
    valeurStock,
    creances,
    paiementsRecus: round2(ventesAgg._sum.montantRecu || 0),
    nbVentes: ventesAgg._count,
    nbApprovisionnements: approsAgg._count,
    series,
  });
}));

// GET /api/rapports/situation — situation financière
router.get('/situation', requirePerm('finance', 'read'), asyncH(async (req, res) => {
  const { from, to } = parseRange(req.query);
  const [ventes, achats, depenses, meds, creditVentes] = await Promise.all([
    prisma.vente.aggregate({ where: { date: { gte: from, lte: to }, statut: 'VALIDEE' }, _sum: { total: true, montantRecu: true } }),
    prisma.approvisionnement.aggregate({ where: { date: { gte: from, lte: to }, statut: 'VALIDE' }, _sum: { totalAchat: true } }),
    prisma.financialTransaction.aggregate({ where: { date: { gte: from, lte: to }, type: 'DEPENSE' }, _sum: { montant: true } }),
    prisma.medicament.findMany({ where: { actif: true }, select: { stock: true, prixAchat: true, prixVente: true } }),
    prisma.vente.aggregate({ where: { statut: 'VALIDEE', modePaiement: 'CREDIT' }, _sum: { total: true, montantRecu: true } }),
  ]);
  const ca = round2(ventes._sum.total || 0);
  const totalAchats = round2(achats._sum.totalAchat || 0);
  const valeurStock = round2(meds.reduce((s, m) => s + toNum(m.stock) * toNum(m.prixAchat), 0));
  const coutVentesItems = await prisma.venteItem.findMany({
    where: { vente: { date: { gte: from, lte: to }, statut: 'VALIDEE' } },
    select: { quantite: true, medicament: { select: { prixAchat: true } } },
  });
  const cout = round2(coutVentesItems.reduce((s, i) => s + toNum(i.quantite) * toNum(i.medicament?.prixAchat), 0));
  const margeBrute = round2(ca - cout);
  const dep = round2(depenses._sum.montant || 0);
  const creances = round2(toNum(creditVentes._sum.total) - toNum(creditVentes._sum.montantRecu));
  const solde = round2(toNum(ventes._sum.montantRecu) - totalAchats - dep);
  res.json({
    periode: { from, to }, totalAchats, totalVentes: ca, chiffreAffaires: ca,
    valeurStock, margeBrute, depenses: dep, solde, creances,
    paiementsRecus: round2(ventes._sum.montantRecu || 0),
  });
}));

// GET /api/rapports/bilan — bilan automatique
router.get('/bilan', requirePerm('finance', 'read'), asyncH(async (req, res) => {
  const to = req.query.to ? endOfDay(new Date(req.query.to)) : endOfDay();
  const [meds, txEntrees, txSorties, creditVentes] = await Promise.all([
    prisma.medicament.findMany({ where: { actif: true }, select: { stock: true, prixAchat: true } }),
    prisma.financialTransaction.aggregate({ where: { sens: 'ENTREE', date: { lte: to } }, _sum: { montant: true } }),
    prisma.financialTransaction.aggregate({ where: { sens: 'SORTIE', date: { lte: to } }, _sum: { montant: true } }),
    prisma.vente.aggregate({ where: { statut: 'VALIDEE', modePaiement: 'CREDIT', date: { lte: to } }, _sum: { total: true, montantRecu: true } }),
  ]);
  const valeurStock = round2(meds.reduce((s, m) => s + toNum(m.stock) * toNum(m.prixAchat), 0));
  const tresorerie = round2(toNum(txEntrees._sum.montant) - toNum(txSorties._sum.montant));
  const creances = round2(toNum(creditVentes._sum.total) - toNum(creditVentes._sum.montantRecu));
  const totalActif = round2(valeurStock + tresorerie + creances);

  // Passif : capital (achats initiaux financés) + dettes éventuelles + résultat
  const dettes = await prisma.financialTransaction.aggregate({ where: { type: 'DEPENSE', sens: 'SORTIE', date: { lte: to } }, _sum: { montant: true } });
  const ca = await prisma.vente.aggregate({ where: { statut: 'VALIDEE', date: { lte: to } }, _sum: { total: true } });
  const achats = await prisma.approvisionnement.aggregate({ where: { statut: 'VALIDE', date: { lte: to } }, _sum: { totalAchat: true } });
  const coutVentesItems = await prisma.venteItem.findMany({
    where: { vente: { statut: 'VALIDEE', date: { lte: to } } },
    select: { quantite: true, medicament: { select: { prixAchat: true } } },
  });
  const cout = coutVentesItems.reduce((s, i) => s + toNum(i.quantite) * toNum(i.medicament?.prixAchat), 0);
  const depenses = round2(toNum(dettes._sum.montant) || 0);
  const resultat = round2(toNum(ca._sum.total) - cout - depenses);
  // Capitaux propres = actif total - dettes fournisseurs éventuelles - résultat (équilibrage automatique)
  const dettesFournisseurs = 0; // extensible : table dettes future
  const capitauxPropres = round2(totalActif - dettesFournisseurs - resultat);
  const totalPassif = round2(capitauxPropres + dettesFournisseurs + resultat);

  res.json({
    date: to,
    actif: { valeurStock, tresorerie, creances, total: totalActif },
    passif: { capitauxPropres, dettesFournisseurs, dettes: depenses, resultat, total: totalPassif },
    memo: { chiffreAffaires: round2(toNum(ca._sum.total)), totalAchats: round2(toNum(achats._sum.totalAchat)), coutVentes: round2(cout), depenses },
  });
}));

// GET /api/rapports/ventes?from&to — historique ventes agrégé par période
router.get('/ventes', requirePerm('rapports', 'read'), asyncH(async (req, res) => {
  const { from, to } = parseRange(req.query);
  const series = await dailySeries(from, to);
  res.json({ periode: { from, to }, series, top: await topProduitsVendus(from, to, 'top', 10) });
}));

export default router;
