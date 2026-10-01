import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { authenticate, requirePerm } from '../middleware/auth.js';
import { asyncH, ApiError } from '../middleware/error.js';
import { toNum } from '../lib/utils.js';

const router = Router();
router.use(authenticate);

// Differential reference-data pull. The cursor is a server timestamp captured
// before the queries, so writes occurring during this pull are picked up by the
// next pull instead of being silently skipped.
router.get('/pull', requirePerm('medicaments', 'read'), asyncH(async (req, res) => {
  const cursor = new Date();
  const rawSince = typeof req.query.since === 'string' ? req.query.since : '';
  let since = null;
  if (rawSince) {
    const parsed = new Date(rawSince);
    if (Number.isNaN(parsed.getTime())) throw new ApiError(400, 'Curseur de synchronisation invalide');
    since = parsed;
  }

  const medicationWhere = since ? { updatedAt: { gt: since } } : {};
  const priceWhere = since ? { importedAt: { gt: since } } : {};
  const [medicaments, catalogue, ventes] = await Promise.all([
    prisma.medicament.findMany({
      where: medicationWhere,
      include: { fournisseur: { select: { id: true, nom: true } } },
      orderBy: { updatedAt: 'asc' },
      take: 10000,
    }),
    prisma.priceCatalog.findMany({
      where: priceWhere,
      orderBy: { importedAt: 'asc' },
      take: 20000,
    }),
    prisma.vente.findMany({
      where: since ? { updatedAt: { gt: since } } : {},
      include: {
        user: { select: { id: true, nom: true, prenom: true, username: true } },
        items: true,
      },
      orderBy: { updatedAt: 'desc' },
      take: 5000,
    }),
  ]);

  res.json({
    cursor: cursor.toISOString(),
    since: since?.toISOString() || null,
    complete: !since,
    medicaments: medicaments.map((m) => ({
      ...m,
      prixAchat: toNum(m.prixAchat),
      prixVente: toNum(m.prixVente),
    })),
    catalogue: catalogue.map((p) => ({ ...p, prix: toNum(p.prix) })),
    ventes: ventes.map((v) => ({
      ...v,
      total: toNum(v.total),
      remise: toNum(v.remise),
      montantRecu: toNum(v.montantRecu),
      items: (v.items || []).map((item) => ({ ...item, prixUnitaire: toNum(item.prixUnitaire), sousTotal: toNum(item.sousTotal) })),
    })),
    counts: { medicaments: medicaments.length, catalogue: catalogue.length, ventes: ventes.length },
  });
}));

export default router;
