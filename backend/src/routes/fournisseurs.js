import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authenticate, requirePerm } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { asyncH, ApiError } from '../middleware/error.js';
import { logAudit, clientIp } from '../lib/utils.js';

const router = Router();
router.use(authenticate);

router.get('/', requirePerm('fournisseurs', 'read'), asyncH(async (req, res) => {
  const rows = await prisma.fournisseur.findMany({ orderBy: { nom: 'asc' }, include: { _count: { select: { approvisionnements: true } } } });
  res.json(rows);
}));

const schema = z.object({
  nom: z.string().min(1).max(120),
  telephone: z.string().max(32).optional().nullable(),
  email: z.string().max(120).optional().nullable().or(z.literal('')),
  adresse: z.string().max(200).optional().nullable(),
  actif: z.boolean().optional().default(true),
});

router.post('/', requirePerm('fournisseurs', 'full'), validate(schema), asyncH(async (req, res) => {
  const f = await prisma.fournisseur.create({ data: { ...req.validated, email: req.validated.email || null } });
  await logAudit(prisma, { user: req.user, action: 'CREATE_FOURNISSEUR', module: 'fournisseurs', ip: clientIp(req), description: `Création fournisseur ${f.nom}`, nouvelleValeur: req.validated });
  res.status(201).json(f);
}));

router.put('/:id', requirePerm('fournisseurs', 'full'), validate(schema.partial()), asyncH(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const f = await prisma.fournisseur.findUnique({ where: { id } });
  if (!f) throw new ApiError(404, 'Fournisseur introuvable');
  const updated = await prisma.fournisseur.update({ where: { id }, data: req.validated });
  await logAudit(prisma, { user: req.user, action: 'UPDATE_FOURNISSEUR', module: 'fournisseurs', ip: clientIp(req), description: `Modification fournisseur ${updated.nom}`, ancienneValeur: f, nouvelleValeur: req.validated });
  res.json(updated);
}));

router.delete('/:id', requirePerm('fournisseurs', 'full'), asyncH(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const count = await prisma.approvisionnement.count({ where: { fournisseurId: id } });
  if (count > 0) {
    await prisma.fournisseur.update({ where: { id }, data: { actif: false } });
    return res.json({ ok: true, message: 'Fournisseur désactivé (historique conservé)' });
  }
  await prisma.fournisseur.delete({ where: { id } });
  res.json({ ok: true, message: 'Fournisseur supprimé' });
}));

export default router;
