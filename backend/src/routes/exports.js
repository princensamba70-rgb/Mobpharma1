import { Router } from 'express';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { prisma } from '../lib/prisma.js';
import { authenticate, requirePerm } from '../middleware/auth.js';
import { asyncH, ApiError } from '../middleware/error.js';
import { toNum, round2, startOfDay, endOfDay } from '../lib/utils.js';
import { parseRange, getSettings, expirationMap, enrichMedicament, listeReapprovisionnement } from '../lib/stats.js';
import { config } from '../config.js';

const router = Router();
router.use(authenticate);

const fmtDate = (d) => d ? new Date(d).toLocaleDateString('fr-FR') : '—';
const fmtDateTime = (d) => d ? new Date(d).toLocaleString('fr-FR') : '—';
const fmtNum = (n) => new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(toNum(n));
const fmtMoney = (n) => `${fmtNum(n)} CDF`;

// Construit le jeu de données selon le type d'export
async function buildDataset(what, query, user) {
  const settings = await getSettings();
  const { from, to } = parseRange(query);
  switch (what) {
    case 'stock': {
      const meds = await prisma.medicament.findMany({ where: { actif: true } });
      const expMap = await expirationMap();
      const rows = meds.map((m) => enrichMedicament(m, expMap, settings.expSeuils))
        .filter((r) => !query.statut || query.statut === 'TOUS' || r.statut === query.statut)
        .sort((a, b) => a.nom.localeCompare(b.nom))
        .map((r) => ({
          code: r.code, nom: r.nom, emballage: r.emballage || '—', stock: r.stock,
          stockMinimal: r.stockMinimal, prixAchat: r.prixAchat, prixVente: r.prixVente,
          expiration: fmtDate(r.expirationProchaine), statut: r.statutLibelle,
          valeurAchat: r.valeurStockAchat, valeurVente: r.valeurStockVente,
        }));
      return {
        title: 'ÉTAT DU STOCK',
        columns: [
          { key: 'code', label: 'Code', width: 10 }, { key: 'nom', label: 'Médicament', width: 38 },
          { key: 'emballage', label: 'Emb.', width: 8 }, { key: 'stock', label: 'Stock', width: 8 },
          { key: 'stockMinimal', label: 'Min.', width: 8 }, { key: 'prixAchat', label: 'Prix achat', width: 12, money: true },
          { key: 'prixVente', label: 'Prix vente', width: 12, money: true }, { key: 'expiration', label: 'Expiration', width: 12 },
          { key: 'statut', label: 'Statut', width: 20 }, { key: 'valeurAchat', label: 'Valeur (achat)', width: 14, money: true },
          { key: 'valeurVente', label: 'Valeur (vente)', width: 14, money: true },
        ],
        rows,
        summary: [
          ['Nombre de produits', rows.length],
          ['Valeur totale (achat)', fmtMoney(rows.reduce((s, r) => s + r.valeurAchat, 0))],
          ['Valeur totale (vente)', fmtMoney(rows.reduce((s, r) => s + r.valeurVente, 0))],
        ],
      };
    }
    case 'ventes': {
      const ventes = await prisma.vente.findMany({
        where: { date: { gte: from, lte: to }, ...(query.statut ? { statut: query.statut } : {}) },
        include: { items: true, user: { select: { nom: true, prenom: true, username: true } } },
        orderBy: { date: 'desc' },
      });
      const rows = ventes.map((v) => ({
        numero: v.numero, date: fmtDateTime(v.date), caissier: `${v.user.prenom} ${v.user.nom}`,
        nbArticles: v.items.reduce((s, i) => s + i.quantite, 0),
        nbLignes: v.items.length, total: toNum(v.total), mode: v.modePaiement, statut: v.statut,
      }));
      return {
        title: 'HISTORIQUE DES VENTES',
        subtitle: `Période : ${fmtDate(from)} → ${fmtDate(to)}`,
        columns: [
          { key: 'numero', label: 'N° Facture', width: 18 }, { key: 'date', label: 'Date / Heure', width: 20 },
          { key: 'caissier', label: 'Caissier', width: 22 }, { key: 'nbLignes', label: 'Lignes', width: 8 },
          { key: 'nbArticles', label: 'Articles', width: 9 }, { key: 'total', label: 'Total', width: 14, money: true },
          { key: 'mode', label: 'Paiement', width: 14 }, { key: 'statut', label: 'Statut', width: 10 },
        ],
        rows,
        summary: [['Nombre de ventes', rows.length], ['Chiffre d\'affaires', fmtMoney(rows.filter(r => r.statut === 'VALIDEE').reduce((s, r) => s + r.total, 0))]],
      };
    }
    case 'approvisionnements': {
      const appros = await prisma.approvisionnement.findMany({
        where: { date: { gte: from, lte: to } },
        include: { fournisseur: true, items: { include: { medicament: true } }, user: { select: { nom: true, prenom: true } } },
        orderBy: { date: 'desc' },
      });
      const rows = [];
      for (const a of appros) {
        for (const it of a.items) {
          rows.push({
            date: fmtDate(a.date), numero: a.numero, fournisseur: a.fournisseur?.nom || '—',
            code: it.medicament?.code, medicament: it.medicament?.nom,
            quantite: it.quantite, lot: it.numLot || '—', expiration: fmtDate(it.dateExpiration),
            prixAchat: toNum(it.prixAchat), prixVente: toNum(it.prixVente),
            valeurAchat: toNum(it.valeurAchat), marge: round2(toNum(it.valeurVente) - toNum(it.valeurAchat)),
          });
        }
      }
      return {
        title: 'RAPPORT DES APPROVISIONNEMENTS',
        subtitle: `Période : ${fmtDate(from)} → ${fmtDate(to)}`,
        columns: [
          { key: 'date', label: 'Date', width: 11 }, { key: 'numero', label: 'N°', width: 18 },
          { key: 'fournisseur', label: 'Fournisseur', width: 18 }, { key: 'code', label: 'Code', width: 8 },
          { key: 'medicament', label: 'Médicament', width: 34 }, { key: 'quantite', label: 'Qté', width: 7 },
          { key: 'lot', label: 'Lot', width: 10 }, { key: 'expiration', label: 'Exp.', width: 11 },
          { key: 'prixAchat', label: 'P. achat', width: 11, money: true }, { key: 'prixVente', label: 'P. vente', width: 11, money: true },
          { key: 'valeurAchat', label: 'Valeur achat', width: 13, money: true }, { key: 'marge', label: 'Marge', width: 12, money: true },
        ],
        rows,
        summary: [['Nombre de lignes', rows.length], ['Total achats', fmtMoney(rows.reduce((s, r) => s + r.valeurAchat, 0))]],
      };
    }
    case 'reapprovisionnement': {
      const list = await listeReapprovisionnement(settings);
      const rows = list.map((r) => ({
        date: fmtDate(new Date()), code: r.code, medicament: r.medicament,
        stockActuel: r.stockActuel, stockMinimal: r.stockMinimal,
        quantiteRecommandee: r.quantiteSuggeree, dernierPrixAchat: r.dernierPrixAchat,
        valeurEstimee: r.valeurEstimee, fournisseur: r.fournisseur, priorite: r.priorite,
      }));
      return {
        title: 'RAPPORT D\'APPROVISIONNEMENT — PRODUITS À RÉAPPROVISIONNER',
        columns: [
          { key: 'date', label: 'Date', width: 11 }, { key: 'code', label: 'Code', width: 9 },
          { key: 'medicament', label: 'Médicament', width: 36 }, { key: 'stockActuel', label: 'Stock actuel', width: 11 },
          { key: 'stockMinimal', label: 'Stock min.', width: 10 }, { key: 'quantiteRecommandee', label: 'Qté recommandée', width: 14 },
          { key: 'dernierPrixAchat', label: 'Dernier prix achat', width: 15, money: true },
          { key: 'valeurEstimee', label: 'Valeur estimée', width: 14, money: true },
          { key: 'fournisseur', label: 'Fournisseur', width: 16 }, { key: 'priorite', label: 'Priorité', width: 10 },
        ],
        rows,
        summary: [
          ['URGENT', rows.filter((r) => r.priorite === 'URGENT').length],
          ['ÉLEVÉ', rows.filter((r) => r.priorite === 'ELEVE').length],
          ['NORMAL', rows.filter((r) => r.priorite === 'NORMAL').length],
          ['Valeur estimée totale', fmtMoney(rows.reduce((s, r) => s + r.valeurEstimee, 0))],
        ],
      };
    }
    case 'journalier': {
      const date = query.date ? new Date(query.date) : new Date();
      const f = startOfDay(date), t = endOfDay(date);
      const ventes = await prisma.vente.findMany({ where: { date: { gte: f, lte: t }, statut: 'VALIDEE' }, include: { items: { include: { medicament: { select: { prixAchat: true } } } } } });
      const ca = round2(ventes.reduce((s, v) => s + toNum(v.total), 0));
      const cout = round2(ventes.flatMap(v => v.items).reduce((s, i) => s + toNum(i.quantite) * toNum(i.medicament?.prixAchat), 0));
      const appros = await prisma.approvisionnement.aggregate({ where: { date: { gte: f, lte: t }, statut: 'VALIDE' }, _sum: { totalAchat: true } });
      const rows = ventes.map((v) => ({
        numero: v.numero, heure: new Date(v.date).toLocaleTimeString('fr-FR'),
        articles: v.items.reduce((s, i) => s + i.quantite, 0),
        total: toNum(v.total), mode: v.modePaiement,
      }));
      return {
        title: 'RAPPORT JOURNALIER',
        subtitle: `Date : ${fmtDate(f)}`,
        columns: [
          { key: 'numero', label: 'N° Facture', width: 18 }, { key: 'heure', label: 'Heure', width: 12 },
          { key: 'articles', label: 'Articles vendus', width: 14 }, { key: 'total', label: 'Total', width: 14, money: true },
          { key: 'mode', label: 'Paiement', width: 14 },
        ],
        rows,
        summary: [
          ['Nombre de ventes', ventes.length],
          ['Produits vendus', rows.reduce((s, r) => s + r.articles, 0)],
          ['Chiffre d\'affaires', fmtMoney(ca)],
          ['Total des achats', fmtMoney(appros._sum.totalAchat || 0)],
          ['Marge brute', fmtMoney(round2(ca - cout))],
          ['Paiements reçus', fmtMoney(ventes.reduce((s, v) => s + toNum(v.montantRecu), 0))],
        ],
      };
    }
    case 'situation': {
      const [ventesAgg, achatsAgg, depAgg, meds, credit] = await Promise.all([
        prisma.vente.aggregate({ where: { date: { gte: from, lte: to }, statut: 'VALIDEE' }, _sum: { total: true, montantRecu: true } }),
        prisma.approvisionnement.aggregate({ where: { date: { gte: from, lte: to }, statut: 'VALIDE' }, _sum: { totalAchat: true } }),
        prisma.financialTransaction.aggregate({ where: { date: { gte: from, lte: to }, type: 'DEPENSE' }, _sum: { montant: true } }),
        prisma.medicament.findMany({ where: { actif: true }, select: { stock: true, prixAchat: true } }),
        prisma.vente.aggregate({ where: { statut: 'VALIDEE', modePaiement: 'CREDIT' }, _sum: { total: true, montantRecu: true } }),
      ]);
      const items = await prisma.venteItem.findMany({
        where: { vente: { date: { gte: from, lte: to }, statut: 'VALIDEE' } },
        select: { quantite: true, medicament: { select: { prixAchat: true } } },
      });
      const cout = round2(items.reduce((s, i) => s + toNum(i.quantite) * toNum(i.medicament?.prixAchat), 0));
      const ca = round2(ventesAgg._sum.total || 0);
      const achats = round2(achatsAgg._sum.totalAchat || 0);
      const valeurStock = round2(meds.reduce((s, m) => s + toNum(m.stock) * toNum(m.prixAchat), 0));
      const dep = round2(depAgg._sum.montant || 0);
      const creances = round2(toNum(credit._sum.total) - toNum(credit._sum.montantRecu));
      const rows = [
        { libelle: 'Total achats', montant: achats },
        { libelle: 'Total ventes (CA)', montant: ca },
        { libelle: 'Coût des ventes', montant: cout },
        { libelle: 'Marge brute', montant: round2(ca - cout) },
        { libelle: 'Valeur du stock', montant: valeurStock },
        { libelle: 'Dépenses', montant: dep },
        { libelle: 'Paiements reçus', montant: round2(ventesAgg._sum.montantRecu || 0) },
        { libelle: 'Créances (ventes à crédit)', montant: creances },
        { libelle: 'Solde de trésorerie (encaissé - achats - dépenses)', montant: round2(toNum(ventesAgg._sum.montantRecu) - achats - dep) },
        { libelle: 'Résultat net', montant: round2(ca - cout - dep) },
      ];
      return {
        title: 'SITUATION FINANCIÈRE',
        subtitle: `Période : ${fmtDate(from)} → ${fmtDate(to)}`,
        columns: [{ key: 'libelle', label: 'Libellé', width: 50 }, { key: 'montant', label: 'Montant (CDF)', width: 18, money: true }],
        rows,
        summary: [],
      };
    }
    case 'audit': {
      const logs = await prisma.auditLog.findMany({
        where: { createdAt: { gte: from, lte: to } }, orderBy: { createdAt: 'desc' }, take: 2000,
      });
      return {
        title: 'JOURNAL D\'AUDIT',
        columns: [
          { key: 'date', label: 'Date / Heure', width: 20 }, { key: 'username', label: 'Utilisateur', width: 16 },
          { key: 'action', label: 'Action', width: 24 }, { key: 'module', label: 'Module', width: 18 },
          { key: 'description', label: 'Description', width: 60 }, { key: 'ip', label: 'IP', width: 16 },
        ],
        rows: logs.map((l) => ({ date: fmtDateTime(l.createdAt), username: l.username, action: l.action, module: l.module, description: l.description || '', ip: l.ip || '' })),
        summary: [['Entrées', logs.length]],
      };
    }
    case 'inventaire': {
      const inv = await prisma.inventaire.findUnique({
        where: { id: parseInt(query.id, 10) },
        include: { items: { include: { medicament: true } }, user: true },
      });
      if (!inv) throw new ApiError(404, 'Inventaire introuvable');
      return {
        title: `INVENTAIRE ${inv.numero}`,
        subtitle: `Date : ${fmtDateTime(inv.date)} — Utilisateur : ${inv.user.prenom} ${inv.user.nom} — Statut : ${inv.statut}`,
        columns: [
          { key: 'code', label: 'Code', width: 9 }, { key: 'nom', label: 'Médicament', width: 36 },
          { key: 'theorique', label: 'Stock théorique', width: 13 }, { key: 'physique', label: 'Stock physique', width: 13 },
          { key: 'ecart', label: 'Écart', width: 8 }, { key: 'prix', label: 'Prix', width: 11, money: true },
          { key: 'valeur', label: 'Valeur écart', width: 13, money: true }, { key: 'observation', label: 'Observation', width: 30 },
        ],
        rows: inv.items.map((i) => ({
          code: i.medicament.code, nom: i.medicament.nom, theorique: i.stockTheorique,
          physique: i.stockPhysique, ecart: i.ecart, prix: toNum(i.prixUnitaire),
          valeur: toNum(i.valeurEcart), observation: i.observation || '',
        })),
        summary: [
          ['Lignes', inv.items.length],
          ['Écarts', inv.items.filter((i) => i.ecart !== 0).length],
          ['Valeur des écarts', fmtMoney(inv.items.reduce((s, i) => s + toNum(i.valeurEcart), 0))],
        ],
      };
    }
    case 'catalogue': {
      const items = await prisma.priceCatalog.findMany({ orderBy: { numero: 'asc' } });
      return {
        title: 'CATALOGUE — LISTE DES PRIX (CDF)',
        subtitle: 'Source : LISTE DES PRIX(1).pdf — Édition du 24/07/2026',
        columns: [
          { key: 'numero', label: 'N°', width: 8 }, { key: 'code', label: 'Code', width: 10 },
          { key: 'designation', label: 'Désignation', width: 50 }, { key: 'emballage', label: 'Emb.', width: 10 },
          { key: 'prix', label: 'Prix (CDF)', width: 14, money: true },
        ],
        rows: items.map((i) => ({ numero: i.numero, code: i.code, designation: i.designation, emballage: i.emballage || '—', prix: toNum(i.prix) })),
        summary: [['Produits', items.length]],
      };
    }
    default:
      throw new ApiError(400, `Type d'export inconnu : ${what}`);
  }
}

function checkPermission(what, user) {
  const financeOnly = ['situation', 'bilan'];
  if (financeOnly.includes(what) && user.roleId === 'ASSISTANT') return false;
  return true;
}

// GET /api/exports/:what?format=xlsx|pdf|csv
router.get('/:what', asyncH(async (req, res) => {
  const { what } = req.params;
  const format = (req.query.format || 'xlsx').toLowerCase();
  if (!checkPermission(what, req.user)) throw new ApiError(403, 'Accès refusé');
  const ds = await buildDataset(what, req.query, req.user);

  if (format === 'csv') {
    const sep = ';';
    const escCsv = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    let csv = '\uFEFF'; // BOM UTF-8 pour Excel
    csv += `${ds.title}\n`;
    if (ds.subtitle) csv += `${ds.subtitle}\n`;
    csv += '\n';
    csv += ds.columns.map((c) => escCsv(c.label)).join(sep) + '\n';
    for (const r of ds.rows) csv += ds.columns.map((c) => escCsv(c.money ? fmtNum(r[c.key]) : r[c.key])).join(sep) + '\n';
    if (ds.summary?.length) {
      csv += '\n';
      for (const [k, v] of ds.summary) csv += `${escCsv(k)}${sep}${escCsv(v)}\n`;
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${what}-${Date.now()}.csv"`);
    return res.send(csv);
  }

  if (format === 'xlsx') {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'AMI PHARMA';
    const ws = wb.addWorksheet(what.slice(0, 28));
    ws.addRow([ds.title]);
    ws.getRow(1).font = { bold: true, size: 14, color: { argb: 'FF0F766E' } };
    if (ds.subtitle) { ws.addRow([ds.subtitle]); ws.getRow(2).font = { italic: true }; }
    ws.addRow([]);
    const header = ws.addRow(ds.columns.map((c) => c.label));
    header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0D9488' } };
    header.alignment = { vertical: 'middle' };
    for (const r of ds.rows) {
      ws.addRow(ds.columns.map((c) => (c.money ? toNum(r[c.key]) : r[c.key])));
    }
    ds.columns.forEach((c, i) => {
      ws.getColumn(i + 1).width = c.width;
      if (c.money) ws.getColumn(i + 1).numFmt = '#,##0.00" CDF"';
    });
    if (ds.summary?.length) {
      ws.addRow([]);
      for (const [k, v] of ds.summary) {
        const row = ws.addRow([k, v]);
        row.font = { bold: true };
      }
    }
    ws.views = [{ state: 'frozen', ySplit: ds.subtitle ? 4 : 3 }];
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${what}-${Date.now()}.xlsx"`);
    return res.send(await wb.xlsx.writeBuffer());
  }

  if (format === 'pdf') {
    const doc = new PDFDocument({ size: 'A4', layout: ds.columns.length > 7 ? 'landscape' : 'portrait', margin: 30 });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${what}-${Date.now()}.pdf"`);
    doc.pipe(res);

    // En-tête pharmacie
    doc.fontSize(16).fillColor('#0f766e').text(config.pharmacy.nom, { align: 'left' });
    doc.fontSize(8).fillColor('#444')
      .text(config.pharmacy.adresse)
      .text(`${config.pharmacy.ville} — Tél : ${config.pharmacy.telephone}`);
    doc.moveDown(0.5);
    doc.fontSize(13).fillColor('#111').text(ds.title, { align: 'center' });
    if (ds.subtitle) doc.fontSize(9).fillColor('#555').text(ds.subtitle, { align: 'center' });
    doc.fontSize(8).fillColor('#777').text(`Généré le ${fmtDateTime(new Date())} par ${req.user.prenom} ${req.user.nom}`, { align: 'right' });
    doc.moveDown(0.6);

    const pageW = doc.page.width - 60;
    const totalW = ds.columns.reduce((s, c) => s + c.width, 0);
    const widths = ds.columns.map((c) => (c.width / totalW) * pageW);

    const drawRow = (vals, opts = {}) => {
      if (doc.y > doc.page.height - 60) {
        doc.addPage({ size: 'A4', layout: doc.page.layout, margin: 30 });
      }
      const y = doc.y;
      let x = 30;
      let maxH = 12;
      vals.forEach((v, i) => {
        const h = doc.heightOfString(String(v ?? ''), { width: widths[i] - 6, ...opts });
        maxH = Math.max(maxH, h + 4);
      });
      if (opts.fill) doc.rect(30, y, pageW, maxH).fill(opts.fill);
      vals.forEach((v, i) => {
        doc.fillColor(opts.color || '#111').fontSize(opts.fontSize || 7.5)
          .text(String(v ?? ''), x + 3, y + 2, { width: widths[i] - 6, height: maxH, ellipsis: true, lineBreak: opts.lineBreak !== false });
        x += widths[i];
      });
      doc.y = y + maxH;
      doc.x = 30;
    };

    drawRow(ds.columns.map((c) => c.label), { fill: '#0d9488', color: '#ffffff', fontSize: 7.5 });
    let idx = 0;
    for (const r of ds.rows) {
      drawRow(ds.columns.map((c) => (c.money ? fmtNum(r[c.key]) : r[c.key])), { fill: idx % 2 ? '#f0fdfa' : null, fontSize: 7 });
      idx++;
    }
    if (ds.summary?.length) {
      doc.moveDown(1);
      for (const [k, v] of ds.summary) {
        doc.fontSize(9).fillColor('#111').text(`${k} : ${v}`, { continued: false });
      }
    }
    doc.end();
    return;
  }

  throw new ApiError(400, 'Format invalide (xlsx | pdf | csv)');
}));

// GET /api/exports/facture/:id/pdf — facture PDF professionnelle
router.get('/facture/:id/pdf', requirePerm('facturation', 'read'), asyncH(async (req, res) => {
  const v = await prisma.vente.findUnique({
    where: { id: parseInt(req.params.id, 10) },
    include: { items: true, user: true },
  });
  if (!v) throw new ApiError(404, 'Facture introuvable');

  const doc = new PDFDocument({ size: 'A4', margin: 40 });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${v.numero}.pdf"`);
  doc.pipe(res);

  // Logo (croix pharmaceutique dessinée) + en-tête
  const teal = '#0d9488';
  doc.save();
  doc.rect(40, 40, 46, 46).fill('#ecfdf5');
  doc.fill(teal);
  doc.rect(56, 48, 14, 30).fill(teal);
  doc.rect(48, 56, 30, 14).fill(teal);
  doc.restore();

  doc.fillColor(teal).fontSize(22).text('AMI PHARMA', 96, 44);
  doc.fontSize(9).fillColor('#444')
    .text(config.pharmacy.adresse, 96, 70)
    .text(`${config.pharmacy.ville} — Tél : ${config.pharmacy.telephone}`, 96);

  doc.fontSize(16).fillColor('#111').text('FACTURE', 380, 44, { width: 175, align: 'right' });
  doc.fontSize(10).text(`N° : ${v.numero}`, 380, 66, { width: 175, align: 'right' });
  doc.fontSize(9).fillColor('#555')
    .text(`Date : ${new Date(v.date).toLocaleDateString('fr-FR')}`, 380, 80, { width: 175, align: 'right' })
    .text(`Heure : ${new Date(v.date).toLocaleTimeString('fr-FR')}`, 380, 92, { width: 175, align: 'right' });

  doc.moveDown(2);
  doc.y = 120;
  doc.fontSize(9).fillColor('#111').text(`Caissier : ${v.user.prenom} ${v.user.nom} (${v.user.username})`, 40);
  doc.text(`Mode de paiement : ${v.modePaiement.replace('_', ' ')}`, 40);
  if (v.statut === 'ANNULEE') {
    doc.fillColor('#dc2626').fontSize(12).text('FACTURE ANNULÉE', 380, 120, { width: 175, align: 'right' });
    doc.fontSize(8).text(v.motifAnnulation || '', 380, 136, { width: 175, align: 'right' });
  }
  doc.y = 160; doc.x = 40;

  // Tableau des articles
  const cols = [
    { label: 'Désignation', w: 250 }, { label: 'Qté', w: 45 },
    { label: 'P.U. (CDF)', w: 90 }, { label: 'Sous-total (CDF)', w: 110 },
  ];
  const drawLine = (vals, opts = {}) => {
    if (doc.y > doc.page.height - 120) doc.addPage();
    const y = doc.y;
    let x = 40;
    let h = 16;
    vals.forEach((v2, i) => { h = Math.max(h, doc.heightOfString(String(v2), { width: cols[i].w - 8, fontSize: 9 }) + 6); });
    if (opts.fill) doc.rect(40, y, 495, h).fill(opts.fill);
    vals.forEach((v2, i) => {
      doc.fillColor(opts.color || '#111').fontSize(9)
        .text(String(v2), x + 4, y + 3, { width: cols[i].w - 8, align: i === 0 ? 'left' : 'right' });
      x += cols[i].w;
    });
    doc.y = y + h; doc.x = 40;
  };
  drawLine(cols.map((c) => c.label), { fill: teal, color: '#fff' });
  let i2 = 0;
  for (const it of v.items) {
    drawLine([it.designation, it.quantite, fmtNum(it.prixUnitaire), fmtNum(it.sousTotal)], { fill: i2 % 2 ? '#f0fdfa' : undefined });
    i2++;
  }
  doc.moveTo(40, doc.y + 2).lineTo(535, doc.y + 2).strokeColor('#ccc').stroke();
  doc.moveDown(1);

  const totalY = doc.y;
  doc.fontSize(10).fillColor('#111').text('TOTAL À PAYER :', 300, totalY, { width: 120, align: 'right' });
  doc.fontSize(13).fillColor(teal).text(fmtMoney(v.total), 425, totalY - 2, { width: 110, align: 'right' });
  if (v.statut === 'VALIDEE') {
    doc.fontSize(9).fillColor('#555')
      .text(`Montant reçu : ${fmtMoney(v.montantRecu)}`, 300, totalY + 20, { width: 235, align: 'right' })
      .text(`Monnaie : ${fmtMoney(Math.max(0, toNum(v.montantRecu) - toNum(v.total)))}`, 300, totalY + 33, { width: 235, align: 'right' });
  }

  doc.fontSize(8).fillColor('#777')
    .text('Signature / Cachet : ______________________', 40, doc.page.height - 110)
    .text('Merci de votre visite — Prompt rétablissement !', 40, doc.page.height - 70, { align: 'center', width: 515 })
    .text(`AMI PHARMA — ${config.pharmacy.ville}`, 40, doc.page.height - 55, { align: 'center', width: 515 });
  doc.end();
}));

export default router;
