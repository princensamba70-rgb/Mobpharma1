// AMI PHARMA — Initialisation de la base de données
// • Rôles + matrice de permissions
// • Utilisateurs initiaux : admin / Finance (+ assistant de démonstration)
// • Catalogue des prix importé depuis le PDF "LISTE DES PRIX(1).pdf" (data/catalog.json)
// • Données de démonstration : fournisseurs, médicaments, approvisionnements, ventes, inventaire
// Les mots de passe sont hachés (bcrypt) — jamais stockés en clair.
import { readFileSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import { PERMISSIONS } from '../config.js';

const prisma = new PrismaClient();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

// PRNG déterministe (données de démo reproductibles)
function mulberry32(seed) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20260724);
const rint = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const daysAgo = (n, hour = 10, minute = 0) => {
  const d = new Date(); d.setDate(d.getDate() - n); d.setHours(hour, minute, 0, 0); return d;
};

function findCatalogFile() {
  const candidates = [
    path.join(__dirname, '..', '..', 'data', 'catalog.json'),
    path.join(__dirname, '..', '..', '..', 'data', 'catalog.json'),
    '/app/data/catalog.json',
  ];
  return candidates.find((f) => existsSync(f));
}

function categorize(name) {
  const n = name.toLowerCase();
  if (/amox|clav|cilline|flox|azole|mycine|cef|sultamicilline|azithro|cipro|metro|doxy/.test(n)) return 'Antibiotiques';
  if (/dol|para|ibu|aspir|diclof|aceclo|tramad|codéine|nimesulide|ketoprof/.test(n)) return 'Antalgiques / Anti-inflammatoires';
  if (/artem|quina|palud|actm|artesunate|lumefantrine|amodiaquine/.test(n)) return 'Antipaludiques';
  if (/vit|folique|fer |calcium|magnésium|zinc|acide folique|b-complex/.test(n)) return 'Vitamines & Minéraux';
  if (/betadine|savon|gel|crème|creme|lotion|poudre|shampooing|hygiène|pansement|seringue/.test(n)) return 'Soins & Dermologie';
  if (/sirop|toux|rhume|grippe| expect|bromhex|ambroxol|salbutamol|ventolin/.test(n)) return 'Voies respiratoires';
  if (/loz|pril|sartan|bisoprolol|amlodipine|furosémide|carvedilol/.test(n)) return 'Cardiologie / Tension';
  return 'Divers';
}

async function wipeBusinessData() {
  console.log('  ♻ Nettoyage des données métier (FORCE_SEED)…');
  await prisma.stockMovement.deleteMany({});
  await prisma.venteItem.deleteMany({});
  await prisma.vente.deleteMany({});
  await prisma.inventaireItem.deleteMany({});
  await prisma.inventaire.deleteMany({});
  await prisma.approvisionnementItem.deleteMany({});
  await prisma.approvisionnement.deleteMany({});
  await prisma.financialTransaction.deleteMany({});
  await prisma.dailyReport.deleteMany({});
  await prisma.notification.deleteMany({});
  await prisma.auditLog.deleteMany({});
  await prisma.medicament.deleteMany({});
  await prisma.fournisseur.deleteMany({});
  await prisma.categorie.deleteMany({});
  await prisma.priceCatalog.deleteMany({});
}

async function main() {
  const existingUsers = await prisma.user.count();
  if (existingUsers > 0 && !process.env.FORCE_SEED) {
    console.log('ℹ Base déjà initialisée — seed ignoré (FORCE_SEED=1 pour forcer).');
    return;
  }
  if (process.env.FORCE_SEED) await wipeBusinessData();

  console.log('▶ AMI PHARMA — initialisation de la base de données…');

  // ---------- 1. Rôles & permissions ----------
  const rolesDef = [
    { id: 'ADMIN', nom: 'Administrateur', description: 'Accès complet au système' },
    { id: 'FINANCE', nom: 'Financier', description: 'Accès finance, lectures opérationnelles' },
    { id: 'ASSISTANT', nom: 'Assistant pharmacien', description: 'Facturation, stock, inventaire, rapport journalier' },
  ];
  for (const r of rolesDef) {
    await prisma.role.upsert({ where: { id: r.id }, create: r, update: { nom: r.nom, description: r.description } });
  }
  await prisma.permission.deleteMany({});
  for (const [roleId, matrix] of Object.entries(PERMISSIONS)) {
    for (const [module, niveau] of Object.entries(matrix)) {
      await prisma.permission.create({ data: { roleId, module, niveau } });
    }
  }
  console.log('  ✔ Rôles et permissions');

  // ---------- 2. Utilisateurs initiaux (mots de passe hachés) ----------
  const usersDef = [
    { nom: 'AMI', prenom: 'Admin', username: 'admin', passwordEnv: 'ADMIN_INITIAL_PASSWORD', roleId: 'ADMIN', telephone: '0820829592' },
    { nom: 'PHARMA', prenom: 'Finance', username: 'Finance', passwordEnv: 'FINANCE_INITIAL_PASSWORD', roleId: 'FINANCE', telephone: '0812271621' },
    { nom: 'MUKENDI', prenom: 'Grace', username: 'assistant', passwordEnv: 'ASSISTANT_INITIAL_PASSWORD', roleId: 'ASSISTANT', telephone: '0810000001' },
  ];
  for (const u of usersDef) {
    const exists = await prisma.user.findUnique({ where: { username: u.username } });
    if (!exists) {
      const initialPassword = process.env[u.passwordEnv];
      if (!initialPassword || initialPassword.length < 8) {
        throw new Error(`${u.passwordEnv} doit être défini avec au moins 8 caractères avant le premier seed.`);
      }
      await prisma.user.create({
        data: {
          nom: u.nom, prenom: u.prenom, username: u.username,
          passwordHash: await bcrypt.hash(initialPassword, 12),
          telephone: u.telephone, roleId: u.roleId, actif: true,
        },
      });
    }
  }
  const adminUser = await prisma.user.findUnique({ where: { username: 'admin' } });
  const assistantUser = await prisma.user.findUnique({ where: { username: 'assistant' } });
  console.log('  ✔ Utilisateurs initiaux créés (mots de passe fournis par variables d’environnement)');

  // ---------- 3. Paramètres ----------
  const settingsDef = {
    'pharmacie.nom': 'AMI PHARMA',
    'pharmacie.slogan': 'Système intégré de gestion de pharmacie',
    'pharmacie.adresse': 'AVENUE NGUMA N° 3 Q/JOLI PARC C/NGALIEMA',
    'pharmacie.ville': 'KINSHASA / RDC',
    'pharmacie.telephone': '0820829592 - 0812271621',
    'expiration.seuils': '180,90,60,30',
    'reappro.facteur': '2',
    devise: 'CDF',
    langue: 'fr',
  };
  for (const [key, value] of Object.entries(settingsDef)) {
    await prisma.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
  }
  console.log('  ✔ Paramètres');

  // ---------- 4. Catalogue des prix (issu du PDF) ----------
  const catalogFile = findCatalogFile();
  let catalog = [];
  if (catalogFile) {
    catalog = JSON.parse(readFileSync(catalogFile, 'utf8'));
    const count = await prisma.priceCatalog.count();
    if (count === 0 || process.env.FORCE_SEED) {
      if (process.env.FORCE_SEED) await prisma.priceCatalog.deleteMany({});
      const CHUNK = 500;
      for (let i = 0; i < catalog.length; i += CHUNK) {
        await prisma.priceCatalog.createMany({
          data: catalog.slice(i, i + CHUNK).map((r) => ({
            numero: r.n, code: String(r.code), designation: r.designation,
            emballage: r.emballage || null, prix: r.prix ?? 0, devise: 'CDF',
            source: 'LISTE DES PRIX(1).pdf',
          })),
        });
      }
    }
    console.log(`  ✔ Catalogue des prix : ${catalog.length} produits importés depuis le PDF`);
  } else {
    console.warn('  ⚠ data/catalog.json introuvable — catalogue vide (utilisez POST /api/catalog/import)');
  }

  // ---------- 5. Catégories & fournisseurs ----------
  const cats = ['Antibiotiques', 'Antalgiques / Anti-inflammatoires', 'Antipaludiques', 'Vitamines & Minéraux', 'Soins & Dermologie', 'Voies respiratoires', 'Cardiologie / Tension', 'Divers'];
  const catIds = {};
  for (const c of cats) {
    const row = await prisma.categorie.upsert({ where: { nom: c }, create: { nom: c }, update: {} });
    catIds[c] = row.id;
  }
  const fournisseursDef = [
    { nom: 'PHARMAKIN Distributors', telephone: '0815550001', adresse: 'Av. du Commerce, Gombe, Kinshasa' },
    { nom: 'MEDICONGO SARL', telephone: '0815550002', adresse: 'Av. Kasa-Vubu, Kinshasa' },
    { nom: 'DENK PHARMA RDC', telephone: '0815550003', adresse: 'Zone industrielle Limete' },
    { nom: 'GROSSISTE NGALIEMA', telephone: '0815550004', adresse: 'Bd du 30 Juin, Ngaliema' },
    { nom: 'LABO PLUS KINSHASA', telephone: '0815550005', adresse: 'Av. de la Libération, Lingwala' },
  ];
  const fournisseurs = [];
  for (const f of fournisseursDef) {
    const exists = await prisma.fournisseur.findFirst({ where: { nom: f.nom } });
    fournisseurs.push(exists || await prisma.fournisseur.create({ data: f }));
  }
  console.log('  ✔ Catégories et fournisseurs');

  // ---------- 6. Médicaments de démonstration (sélection depuis le catalogue PDF) ----------
  const existingMeds = await prisma.medicament.count();
  if (existingMeds > 0 && !process.env.FORCE_SEED) {
    console.log('  ℹ Médicaments déjà présents — données de démo ignorées.');
    return;
  }

  const selection = [];
  const byCode = new Map();
  for (const item of catalog) {
    if (item.n % 23 === 1) selection.push(item);
    byCode.set(item.code, item);
  }
  // produits emblématiques cités dans le cahier des charges
  for (const term of ['amoxicilline', 'augmentin', 'bactrim', 'betadine', 'bisoprolol', 'paracetamol', 'doliprane', 'ibuprof', 'aspirine', 'vitamine c', 'amoxi denk', 'aclav']) {
    const hit = catalog.find((c) => c.designation.toLowerCase().includes(term));
    if (hit && !selection.some((s) => s.code === hit.code)) selection.push(hit);
  }
  // quelques produits à prix = 0 CDF (tels quels dans le PDF)
  for (const z of catalog.filter((c) => c.prix === 0).slice(0, 3)) {
    if (!selection.some((s) => s.code === z.code)) selection.push(z);
  }

  const meds = [];
  let idx = 0;
  for (const item of selection) {
    const prixVente = item.prix ?? 0;
    const prixAchat = prixVente > 0 ? round2(prixVente * (0.72 + rnd() * 0.08)) : 0;
    const stockMinimal = pick([5, 8, 10, 12, 15, 20]);
    const fournisseur = pick(fournisseurs);
    const med = await prisma.medicament.create({
      data: {
        code: item.code, nom: item.designation, designation: item.designation,
        emballage: item.emballage, prixAchat, prixVente, stock: 0, stockMinimal,
        categorieId: catIds[categorize(item.designation)], fournisseurId: fournisseur.id,
      },
    });
    meds.push({ med, cat: item, prixAchat, prixVente, stockMinimal, fournisseur, idx });
    idx++;
  }
  console.log(`  ✔ ${meds.length} médicaments créés depuis le catalogue PDF`);

  // ---------- 7. Approvisionnements (12 bons de commande sur 60 jours, avec lots) ----------
  // Scénarios de stock par produit
  const NB_EVENTS = 12;
  const events = [];
  for (let e = 0; e < NB_EVENTS; e++) {
    events.push({
      date: daysAgo(rint(2, 58), rint(8, 16), rint(0, 59)),
      fournisseur: fournisseurs[e % fournisseurs.length],
      items: [],
    });
  }

  const planVente = []; // { medId, qtyTotale à vendre, prixVente }
  for (const m of meds) {
    const scenario = m.idx % 12;
    const qtyAchetee = rint(30, 110);
    let toSell, expOffsetDays;
    if (scenario === 0) { toSell = qtyAchetee; expOffsetDays = rint(120, 500); }          // épuisé
    else if (scenario === 1) { toSell = qtyAchetee - Math.max(1, Math.floor(m.stockMinimal * 0.6)); expOffsetDays = rint(150, 400); } // faible
    else if (scenario === 2) { toSell = Math.floor(qtyAchetee * 0.4); expOffsetDays = rint(10, 28); }   // expiration < 30j
    else if (scenario === 3) { toSell = Math.floor(qtyAchetee * 0.3); expOffsetDays = rint(35, 85); }   // expiration < 90j
    else if (scenario === 4) { toSell = Math.floor(qtyAchetee * 0.5); expOffsetDays = -rint(5, 40); }   // lot expiré
    else { toSell = Math.floor(qtyAchetee * (0.3 + rnd() * 0.4)); expOffsetDays = rint(100, 700); }     // normal

    if (m.prixVente <= 0) toSell = 0; // produits à prix 0 CDF : pas de vente démo
    const ev = events[m.idx % NB_EVENTS];
    const lot = `LOT-${String(m.med.id).padStart(4, '0')}-${rint(10, 99)}`;
    const expDate = new Date(); expDate.setDate(expDate.getDate() + expOffsetDays);
    ev.items.push({
      med: m.med, quantite: qtyAchetee, prixAchat: m.prixAchat, prixVente: m.prixVente,
      numLot: lot, dateExpiration: expDate,
    });
    planVente.push({ med: m.med, reste: toSell, prixVente: m.prixVente });
  }

  let approSeq = 0;
  const year = new Date().getFullYear();
  for (const ev of events.sort((a, b) => a.date - b.date)) {
    approSeq++;
    const numero = `APPR-${year}-${String(approSeq).padStart(6, '0')}`;
    let totalAchat = 0, totalVente = 0;
    const appro = await prisma.approvisionnement.create({
      data: {
        numero, fournisseurId: ev.fournisseur.id, userId: adminUser.id, date: ev.date,
        totalAchat: 0, totalVente: 0, margePotentielle: 0, statut: 'VALIDE',
      },
    });
    for (const it of ev.items) {
      const vA = round2(it.quantite * it.prixAchat);
      const vV = round2(it.quantite * it.prixVente);
      totalAchat += vA; totalVente += vV;
      await prisma.approvisionnementItem.create({
        data: {
          approvisionnementId: appro.id, medicamentId: it.med.id, quantite: it.quantite,
          prixAchat: it.prixAchat, prixVente: it.prixVente, valeurAchat: vA, valeurVente: vV,
          numLot: it.numLot, dateExpiration: it.dateExpiration, quantiteRestante: it.quantite,
        },
      });
      await prisma.medicament.update({ where: { id: it.med.id }, data: { stock: { increment: it.quantite } } });
      await prisma.stockMovement.create({
        data: {
          medicamentId: it.med.id, type: 'APPROVISIONNEMENT', quantite: it.quantite,
          stockAvant: 0, stockApres: it.quantite, reference: numero,
          motif: `Lot ${it.numLot}`, userId: adminUser.id, createdAt: ev.date,
        },
      });
    }
    await prisma.approvisionnement.update({
      where: { id: appro.id },
      data: { totalAchat: round2(totalAchat), totalVente: round2(totalVente), margePotentielle: round2(totalVente - totalAchat) },
    });
    await prisma.financialTransaction.create({
      data: { type: 'ACHAT', montant: round2(totalAchat), sens: 'SORTIE', date: ev.date, reference: numero, description: `Approvisionnement ${numero}` },
    });
  }
  console.log(`  ✔ ${events.length} approvisionnements (${meds.length} lots)`);

  // ---------- 8. Ventes de démonstration (30 derniers jours, stock décrémenté FIFO) ----------
  const modes = ['ESPECES', 'ESPECES', 'ESPECES', 'MOBILE_MONEY', 'MOBILE_MONEY', 'CARTE', 'CREDIT'];
  const pool = planVente.filter((p) => p.reste > 0);
  let venteSeq = 0;
  const ventesCreated = [];

  const makeSale = async (date) => {
    const lines = [];
    const nbLines = rint(1, 5);
    for (let l = 0; l < nbLines; l++) {
      const candidates = pool.filter((p) => p.reste > 0 && !lines.some((x) => x.p === p));
      if (!candidates.length) break;
      const p = pick(candidates);
      const qty = Math.min(p.reste, rint(1, 8));
      if (qty <= 0) continue;
      p.reste -= qty;
      lines.push({ p, qty, sousTotal: round2(qty * p.prixVente) });
    }
    if (!lines.length) return;
    venteSeq++;
    const numero = `FAC-${year}-${String(venteSeq).padStart(6, '0')}`;
    const mode = pick(modes);
    const total = round2(lines.reduce((s, x) => s + x.sousTotal, 0));
    const user = rnd() < 0.7 ? assistantUser : adminUser;
    const vente = await prisma.vente.create({
      data: {
        numero, userId: user.id, date, total,
        montantRecu: mode === 'CREDIT' ? 0 : total,
        modePaiement: mode, statut: 'VALIDEE',
      },
    });
    for (const { p, qty, sousTotal } of lines) {
      await prisma.venteItem.create({
        data: {
          venteId: vente.id, medicamentId: p.med.id, designation: p.med.nom,
          emballage: p.med.emballage, quantite: qty, prixUnitaire: p.prixVente, sousTotal,
        },
      });
      const before = (await prisma.medicament.findUnique({ where: { id: p.med.id } })).stock;
      await prisma.medicament.update({ where: { id: p.med.id }, data: { stock: before - qty } });
      // FIFO lots
      let restant = qty;
      const lots = await prisma.approvisionnementItem.findMany({
        where: { medicamentId: p.med.id, quantiteRestante: { gt: 0 } },
        orderBy: { dateExpiration: 'asc' },
      });
      for (const lot of lots) {
        if (restant <= 0) break;
        const take = Math.min(restant, lot.quantiteRestante);
        await prisma.approvisionnementItem.update({ where: { id: lot.id }, data: { quantiteRestante: lot.quantiteRestante - take } });
        restant -= take;
      }
      await prisma.stockMovement.create({
        data: {
          medicamentId: p.med.id, type: 'VENTE', quantite: -qty,
          stockAvant: before, stockApres: before - qty, reference: numero,
          motif: 'Vente', userId: user.id, createdAt: date,
        },
      });
    }
    await prisma.financialTransaction.create({
      data: { type: 'VENTE', montant: total, sens: 'ENTREE', date, reference: numero, description: `Vente ${numero}` },
    });
    ventesCreated.push(vente);
  };

  // ventes réparties sur 30 jours : on génère jusqu'à épuisement du plan de vente
  const totalReste = pool.reduce((s, p) => s + p.reste, 0);
  const salesTarget = Math.ceil(totalReste / 10) + 20;
  // d'abord les ventes du jour (activité visible immédiatement)
  for (let k = 0; k < rint(6, 10); k++) {
    const d = new Date(); d.setHours(rint(8, Math.max(9, new Date().getHours() - 1)), rint(0, 59), 0, 0);
    await makeSale(d);
  }
  let made = 0;
  while (made < salesTarget && pool.some((p) => p.reste > 0)) {
    const dAgo = 1 + Math.floor(Math.pow(rnd(), 1.2) * 30); // biaisé vers les jours récents
    await makeSale(daysAgo(dAgo, rint(8, 18), rint(0, 59)));
    made++;
  }
  console.log(`  ✔ ${ventesCreated.length} ventes générées (30 derniers jours, ${totalReste} unités planifiées)`);

  // ---------- 9. Inventaire de démonstration ----------
  const allMeds = await prisma.medicament.findMany({ orderBy: { nom: 'asc' } });
  const inv = await prisma.inventaire.create({
    data: {
      numero: `INV-${year}-000001`, userId: assistantUser.id, date: daysAgo(0, 8, 0),
      statut: 'EN_COURS', observations: 'Inventaire physique de démonstration — à compléter et valider.',
    },
  });
  for (const m of allMeds) {
    await prisma.inventaireItem.create({
      data: {
        inventaireId: inv.id, medicamentId: m.id, stockTheorique: m.stock,
        stockPhysique: m.stock, ecart: 0, prixUnitaire: Number(m.prixAchat), valeurEcart: 0,
      },
    });
  }
  console.log('  ✔ Inventaire de démonstration (EN_COURS)');

  // ---------- 10. Rapports journaliers (7 derniers jours) ----------
  for (let d = 6; d >= 0; d--) {
    const from = daysAgo(d, 0, 0); const to = daysAgo(d, 23, 59);
    const ventes = await prisma.vente.findMany({ where: { date: { gte: from, lte: to }, statut: 'VALIDEE' }, include: { items: { include: { medicament: { select: { prixAchat: true } } } } } });
    const ca = round2(ventes.reduce((s, v) => s + Number(v.total), 0));
    const items = ventes.flatMap((v) => v.items);
    const cout = round2(items.reduce((s, i) => s + i.quantite * Number(i.medicament?.prixAchat || 0), 0));
    const achats = await prisma.approvisionnement.aggregate({ where: { date: { gte: from, lte: to }, statut: 'VALIDE' }, _sum: { totalAchat: true } });
    await prisma.dailyReport.upsert({
      where: { date: from },
      create: {
        date: from, nbVentes: ventes.length,
        nbProduitsVendus: items.reduce((s, i) => s + i.quantite, 0),
        chiffreAffaires: ca, totalAchats: Number(achats._sum.totalAchat || 0),
        margeBrute: round2(ca - cout), paiementsRecus: round2(ventes.reduce((s, v) => s + Number(v.montantRecu), 0)),
      },
      update: {},
    });
  }
  console.log('  ✔ Rapports journaliers (7 jours)');

  // ---------- 11. Notifications persistées ----------
  await prisma.notification.createMany({
    data: [
      { type: 'SYSTEME', niveau: 'success', titre: 'Bienvenue sur AMI PHARMA', message: 'Le système est initialisé avec le catalogue officiel (LISTE DES PRIX du 24/07/2026, devise CDF).' },
      { type: 'FINANCE', niveau: 'info', titre: 'Rapport financier disponible', message: '💰 Le rapport financier de la période est consultable dans le module Finance.' },
    ],
  });
  console.log('  ✔ Notifications');

  console.log('✅ Initialisation terminée.');
  console.log('   Comptes initiaux créés. Changez les mots de passe après la première connexion.');
}

main()
  .catch((e) => { console.error('❌ Seed échoué :', e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
