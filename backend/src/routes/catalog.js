import { Router } from 'express';
import { readFileSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { prisma } from '../lib/prisma.js';
import { authenticate, requirePerm } from '../middleware/auth.js';
import { asyncH, ApiError } from '../middleware/error.js';
import { logAudit, clientIp, toNum } from '../lib/utils.js';

const router = Router();
router.use(authenticate);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// GET /api/catalog — liste paginée du catalogue PDF
router.get('/', requirePerm('catalogue', 'read'), asyncH(async (req, res) => {
  const { q, page = 1, pageSize = 25 } = req.query;
  const where = q
    ? { OR: [{ code: { contains: q } }, { designation: { contains: q } }, { emballage: { contains: q } }] }
    : {};
  const total = await prisma.priceCatalog.count({ where });
  const p = Math.max(1, parseInt(page, 10));
  const ps = Math.min(100, Math.max(5, parseInt(pageSize, 10)));
  const items = await prisma.priceCatalog.findMany({
    where, orderBy: { numero: 'asc' }, skip: (p - 1) * ps, take: ps,
  });
  res.json({ total, page: p, pageSize: ps, items: items.map((i) => ({ ...i, prix: toNum(i.prix) })) });
}));

// GET /api/catalog/lookup?code=1005 ou ?q=amoxi — récupération automatique produit/prix
router.get('/lookup', requirePerm('catalogue', 'read'), asyncH(async (req, res) => {
  const { code, q } = req.query;
  if (code) {
    const item = await prisma.priceCatalog.findFirst({ where: { code: String(code) } });
    return res.json(item ? [{ ...item, prix: toNum(item.prix) }] : []);
  }
  if (!q) return res.json([]);
  const items = await prisma.priceCatalog.findMany({
    where: { OR: [{ code: { contains: q } }, { designation: { contains: q } }, { emballage: { contains: q } }] },
    take: 15, orderBy: { numero: 'asc' },
  });
  res.json(items.map((i) => ({ ...i, prix: toNum(i.prix) })));
}));

// POST /api/catalog/import — importer/actualiser le catalogue depuis le fichier JSON (issu du PDF)
router.post('/import', requirePerm('catalogue', 'full'), asyncH(async (req, res) => {
  const candidates = [
    req.body?.filePath,
    path.join(__dirname, '..', '..', '..', 'data', 'catalog.json'),
    path.join(__dirname, '..', '..', 'data', 'catalog.json'),
  ].filter(Boolean);
  const file = candidates.find((f) => existsSync(f));
  if (!file) throw new ApiError(404, 'Fichier catalogue introuvable (data/catalog.json)');
  const rows = JSON.parse(readFileSync(file, 'utf8'));
  let created = 0, updated = 0, skipped = 0;
  for (const r of rows) {
    if (!r.code || !r.designation) { skipped++; continue; }
    const existing = await prisma.priceCatalog.findFirst({
      where: { code: String(r.code), designation: r.designation },
    });
    if (existing) {
      await prisma.priceCatalog.update({
        where: { id: existing.id },
        data: { numero: r.n ?? existing.numero, emballage: r.emballage, prix: r.prix ?? 0, devise: 'CDF', importedAt: new Date() },
      });
      updated++;
    } else {
      await prisma.priceCatalog.create({
        data: {
          numero: r.n ?? null, code: String(r.code), designation: r.designation,
          emballage: r.emballage || null, prix: r.prix ?? 0, devise: 'CDF',
          source: 'LISTE DES PRIX(1).pdf',
        },
      });
      created++;
    }
  }
  await logAudit(prisma, {
    user: req.user, action: 'IMPORT_CATALOG', module: 'catalogue', ip: clientIp(req),
    description: `Import du catalogue des prix : ${created} créés, ${updated} actualisés, ${skipped} ignorés`,
  });
  res.json({ ok: true, created, updated, skipped, total: rows.length });
}));

export default router;
