import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { authenticate } from '../middleware/auth.js';
import { asyncH } from '../middleware/error.js';
import { computeAlertes, getSettings } from '../lib/stats.js';

const router = Router();
router.use(authenticate);

// GET /api/notifications — centre de notifications (dynamiques + persistées)
router.get('/', asyncH(async (req, res) => {
  // Notifications are ancillary, but their independent persistence query and
  // stock-alert snapshot should not serialize one another.
  const settingsPromise = getSettings();
  const alertesPromise = settingsPromise.then((settings) => computeAlertes(settings));
  const persisteesPromise = prisma.notification.findMany({
    where: { OR: [{ userId: null }, { userId: req.user.id }] },
    orderBy: { createdAt: 'desc' }, take: 30,
  });
  const [alertes, persistees] = await Promise.all([alertesPromise, persisteesPromise]);
  const dynamiques = [];
  if (alertes.epuises > 0) dynamiques.push({ id: 'dyn-epuise', type: 'STOCK_EPUISE', niveau: 'danger', titre: 'Ruptures de stock', message: `🔴 ${alertes.epuises} médicament(s) sont épuisés`, createdAt: new Date() });
  if (alertes.faibles > 0) dynamiques.push({ id: 'dyn-faible', type: 'STOCK_FAIBLE', niveau: 'warning', titre: 'Stock faible', message: `🟠 ${alertes.faibles} médicament(s) ont un stock faible`, createdAt: new Date() });
  if (alertes.expirationProche > 0) dynamiques.push({ id: 'dyn-exp', type: 'EXPIRATION', niveau: 'warning', titre: 'Expiration proche', message: `⚠️ ${alertes.expirationProche} médicament(s) expirent dans moins de ${alertes.seuilCourt} jours`, createdAt: new Date() });
  if (alertes.expires > 0) dynamiques.push({ id: 'dyn-expire', type: 'EXPIRATION', niveau: 'danger', titre: 'Produits expirés', message: `🔴 ${alertes.expires} médicament(s) sont expirés`, createdAt: new Date() });
  if (alertes.reapprovisionnement > 0) dynamiques.push({ id: 'dyn-reappro', type: 'REAPPROVISIONNEMENT', niveau: 'info', titre: 'Réapprovisionnement', message: `📦 ${alertes.reapprovisionnement} produit(s) doivent être réapprovisionnés`, createdAt: new Date() });
  if (['ADMIN', 'FINANCE'].includes(req.user.roleId)) {
    dynamiques.push({ id: 'dyn-finance', type: 'FINANCE', niveau: 'success', titre: 'Rapport financier', message: '💰 Rapport financier disponible dans le module Finance', createdAt: new Date() });
  }

  res.json({ alertes, dynamiques, persistees });
}));

// POST /api/notifications/:id/lu
router.post('/:id/lu', asyncH(async (req, res) => {
  await prisma.notification.updateMany({ where: { id: parseInt(req.params.id, 10) }, data: { lu: true } });
  res.json({ ok: true });
}));

// POST /api/notifications/lu-tout
router.post('/lu-tout', asyncH(async (req, res) => {
  await prisma.notification.updateMany({ where: { OR: [{ userId: null }, { userId: req.user.id }] }, data: { lu: true } });
  res.json({ ok: true });
}));

export default router;
