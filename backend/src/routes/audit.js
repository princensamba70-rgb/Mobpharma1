import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { authenticate, requirePerm } from '../middleware/auth.js';
import { asyncH } from '../middleware/error.js';

const router = Router();
router.use(authenticate, requirePerm('audit', 'read'));

// GET /api/audit — journal d'audit
router.get('/', asyncH(async (req, res) => {
  const { q, module: mod, page = 1, pageSize = 30, from, to } = req.query;
  const where = {};
  if (mod) where.module = mod;
  if (q) where.OR = [{ action: { contains: q } }, { description: { contains: q } }, { username: { contains: q } }];
  if (from || to) where.createdAt = {};
  if (from) where.createdAt.gte = new Date(from);
  if (to) { const d = new Date(to); d.setHours(23, 59, 59, 999); where.createdAt.lte = d; }
  const total = await prisma.auditLog.count({ where });
  const p = Math.max(1, parseInt(page, 10));
  const ps = Math.min(100, Math.max(5, parseInt(pageSize, 10)));
  const items = await prisma.auditLog.findMany({
    where, orderBy: { createdAt: 'desc' }, skip: (p - 1) * ps, take: ps,
  });
  const modules = await prisma.auditLog.findMany({ distinct: ['module'], select: { module: true } });
  res.json({ total, page: p, pageSize: ps, items, modules: modules.map((m) => m.module) });
}));

export default router;
