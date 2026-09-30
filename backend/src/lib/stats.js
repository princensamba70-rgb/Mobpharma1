// Helpers statistiques & rapports — tous les calculs viennent de la base de données
import { prisma } from './prisma.js';
import { toNum, round2, dayKey, startOfDay, endOfDay, addDays } from './utils.js';

export function parseRange(query = {}) {
  const today = startOfDay();
  let from, to;
  if (query.from && query.to) {
    from = startOfDay(new Date(query.from));
    to = endOfDay(new Date(query.to));
  } else if (query.period === 'week') {
    from = addDays(today, -6); to = endOfDay();
  } else if (query.period === 'month') {
    from = addDays(today, -29); to = endOfDay();
  } else if (query.period === 'today') {
    from = today; to = endOfDay();
  } else {
    from = addDays(today, -29); to = endOfDay();
  }
  return { from, to };
}

export async function getSettings() {
  const rows = await prisma.setting.findMany();
  const s = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return {
    expSeuils: (s['expiration.seuils'] || '180,90,60,30').split(',').map(Number).filter(Boolean).sort((a, b) => b - a),
    reapproFacteur: toNum(s['reappro.facteur'] || 2),
    devise: s['devise'] || 'CDF',
    ...s,
  };
}

// Prochaine expiration par médicament (lots avec reste > 0)
export async function expirationMap() {
  const rows = await prisma.approvisionnementItem.groupBy({
    by: ['medicamentId'],
    where: { quantiteRestante: { gt: 0 }, dateExpiration: { not: null } },
    _min: { dateExpiration: true },
  });
  const map = {};
  for (const r of rows) map[r.medicamentId] = r._min.dateExpiration;
  return map;
}

export function enrichMedicament(med, expMap, seuils = [180, 90, 60, 30]) {
  const stock = toNum(med.stock);
  const min = toNum(med.stockMinimal);
  const exp = expMap?.[med.id] || null;
  const joursRestants = exp ? Math.floor((new Date(exp) - new Date()) / 86400000) : null;
  let statut = 'NORMAL';
  let statutLibelle = '🟢 Stock normal';
  if (!med.actif) { statut = 'ARCHIVE'; statutLibelle = '📦 Archivé'; }
  else if (exp && joursRestants < 0) { statut = 'EXPIRE'; statutLibelle = '🔴 Produit expiré'; }
  else if (stock <= 0) { statut = 'EPUISE'; statutLibelle = '🔴 Stock épuisé'; }
  else if (exp && joursRestants <= (seuils[seuils.length - 1] || 30)) { statut = 'EXPIRATION_PROCHE'; statutLibelle = '⚠️ Expiration proche'; }
  else if (stock <= min) { statut = 'FAIBLE'; statutLibelle = '🟠 Stock faible'; }
  return {
    ...med,
    prixAchat: toNum(med.prixAchat),
    prixVente: toNum(med.prixVente),
    expirationProchaine: exp,
    joursRestants,
    statut,
    statutLibelle,
    valeurStockAchat: round2(stock * toNum(med.prixAchat)),
    valeurStockVente: round2(stock * toNum(med.prixVente)),
  };
}

// Séries journalières ventes/achats/marge sur une période
export async function dailySeries(from, to) {
  const [ventes, items, appros] = await Promise.all([
    prisma.vente.findMany({ where: { date: { gte: from, lte: to }, statut: 'VALIDEE' }, select: { id: true, date: true, total: true, montantRecu: true } }),
    prisma.venteItem.findMany({
      where: { vente: { date: { gte: from, lte: to }, statut: 'VALIDEE' } },
      select: { quantite: true, sousTotal: true, medicament: { select: { prixAchat: true } } },
    }),
    prisma.approvisionnement.findMany({ where: { date: { gte: from, lte: to }, statut: 'VALIDE' }, select: { date: true, totalAchat: true } }),
  ]);
  const map = {};
  const ensure = (k) => (map[k] ||= { date: k, ca: 0, achats: 0, marge: 0, nbVentes: 0, nbProduits: 0 });
  for (const v of ventes) {
    const e = ensure(dayKey(v.date));
    e.ca += toNum(v.total); e.nbVentes += 1;
  }
  // marge & produits vendus : approximation exacte par item (sousTotal - qty*prixAchat du médicament)
  for (const it of items) {
    // retrouver la date via ventes
  }
  const itemsAvecDate = await prisma.venteItem.findMany({
    where: { vente: { date: { gte: from, lte: to }, statut: 'VALIDEE' } },
    select: { quantite: true, sousTotal: true, vente: { select: { date: true } }, medicament: { select: { prixAchat: true } } },
  });
  for (const it of itemsAvecDate) {
    const e = ensure(dayKey(it.vente.date));
    e.nbProduits += toNum(it.quantite);
    e.marge += toNum(it.sousTotal) - toNum(it.quantite) * toNum(it.medicament?.prixAchat);
  }
  for (const a of appros) {
    const e = ensure(dayKey(a.date));
    e.achats += toNum(a.totalAchat);
  }
  // compléter tous les jours de la période
  const out = [];
  for (let d = startOfDay(from); d <= to; d = addDays(d, 1)) {
    const k = dayKey(d);
    const e = map[k] || { date: k, ca: 0, achats: 0, marge: 0, nbVentes: 0, nbProduits: 0 };
    out.push({ ...e, ca: round2(e.ca), achats: round2(e.achats), marge: round2(e.marge) });
  }
  return out;
}

// Top / flop produits vendus sur période
export async function topProduitsVendus(from, to, sens = 'top', limit = 5) {
  const items = await prisma.venteItem.findMany({
    where: { vente: { date: { gte: from, lte: to }, statut: 'VALIDEE' } },
    select: { quantite: true, sousTotal: true, medicamentId: true, designation: true },
  });
  const agg = {};
  for (const it of items) {
    const a = (agg[it.medicamentId] ||= { medicamentId: it.medicamentId, designation: it.designation, quantite: 0, total: 0 });
    a.quantite += toNum(it.quantite); a.total += toNum(it.sousTotal);
  }
  const list = Object.values(agg).map((a) => ({ ...a, total: round2(a.total) }));
  list.sort((x, y) => (sens === 'top' ? y.quantite - x.quantite : x.quantite - y.quantite));
  return list.slice(0, limit);
}

// Top / flop produits approvisionnés sur période
export async function topProduitsAchete(from, to, sens = 'top', limit = 5) {
  const items = await prisma.approvisionnementItem.findMany({
    where: { approvisionnement: { date: { gte: from, lte: to }, statut: 'VALIDE' } },
    select: { quantite: true, valeurAchat: true, medicamentId: true, medicament: { select: { nom: true, code: true } } },
  });
  const agg = {};
  for (const it of items) {
    const a = (agg[it.medicamentId] ||= {
      medicamentId: it.medicamentId, code: it.medicament?.code, designation: it.medicament?.nom, quantite: 0, total: 0,
    });
    a.quantite += toNum(it.quantite); a.total += toNum(it.valeurAchat);
  }
  const list = Object.values(agg).map((a) => ({ ...a, total: round2(a.total) }));
  list.sort((x, y) => (sens === 'top' ? y.quantite - x.quantite : x.quantite - y.quantite));
  return list.slice(0, limit);
}

// Produits à réapprovisionner avec priorité
export async function listeReapprovisionnement(settings) {
  const meds = await prisma.medicament.findMany({
    where: { actif: true },
    include: { fournisseur: { select: { nom: true } } },
  });
  const expMap = await expirationMap();
  const facteur = settings?.reapproFacteur ?? 2;
  const list = meds
    .map((m) => enrichMedicament(m, expMap, settings?.expSeuils))
    .filter((m) => m.stock <= Math.max(m.stockMinimal * 1.5, m.stockMinimal))
    .map((m) => {
      const cible = Math.max(Math.round(toNum(m.stockMinimal) * facteur), toNum(m.stockMinimal) + 5);
      const quantiteSuggeree = Math.max(0, cible - toNum(m.stock));
      let priorite = 'NORMAL';
      if (m.stock <= 0) priorite = 'URGENT';
      else if (m.stock < m.stockMinimal) priorite = 'ELEVE';
      return {
        id: m.id, code: m.code, medicament: m.nom, emballage: m.emballage,
        stockActuel: m.stock, stockMinimal: m.stockMinimal,
        quantiteSuggeree, cible,
        dernierPrixAchat: m.prixAchat,
        valeurEstimee: round2(quantiteSuggeree * m.prixAchat),
        fournisseur: m.fournisseur?.nom || '—',
        priorite,
      };
    });
  const ordre = { URGENT: 0, ELEVE: 1, NORMAL: 2 };
  list.sort((a, b) => ordre[a.priorite] - ordre[b.priorite] || a.code.localeCompare(b.code));
  return list;
}

// Alertes globales (notifications dynamiques)
export async function computeAlertes(settings) {
  const meds = await prisma.medicament.findMany({ where: { actif: true } });
  const expMap = await expirationMap();
  const seuils = settings?.expSeuils || [180, 90, 60, 30];
  const enriched = meds.map((m) => enrichMedicament(m, expMap, seuils));
  const epuises = enriched.filter((m) => m.statut === 'EPUISE');
  const faibles = enriched.filter((m) => m.statut === 'FAIBLE');
  const expires = enriched.filter((m) => m.statut === 'EXPIRE');
  const seuilCourt = seuils[seuils.length - 1] || 30;
  const expProche = enriched.filter((m) => m.joursRestants !== null && m.joursRestants >= 0 && m.joursRestants <= seuilCourt && m.statut !== 'EXPIRE');
  const reappro = await listeReapprovisionnement(settings);
  return {
    epuises: epuises.length, faibles: faibles.length, expires: expires.length,
    expirationProche: expProche.length, reapprovisionnement: reappro.length,
    seuilCourt,
  };
}
