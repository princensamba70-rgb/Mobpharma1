import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authenticate, requirePerm } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { asyncH, ApiError } from '../middleware/error.js';
import { logAudit, clientIp } from '../lib/utils.js';

const router = Router();
router.use(authenticate, requirePerm('utilisateurs', 'full'));

const publicUser = (u) => ({
  id: u.id, nom: u.nom, prenom: u.prenom, username: u.username,
  telephone: u.telephone, email: u.email, roleId: u.roleId,
  roleName: u.role?.nom, actif: u.actif, createdAt: u.createdAt, lastLoginAt: u.lastLoginAt,
});

// GET /api/users
router.get('/', asyncH(async (req, res) => {
  const users = await prisma.user.findMany({ include: { role: true }, orderBy: { createdAt: 'desc' } });
  res.json(users.map(publicUser));
}));

const userSchema = z.object({
  nom: z.string().min(1).max(64),
  prenom: z.string().min(1).max(64),
  username: z.string().min(3).max(32).regex(/^[a-zA-Z0-9._-]+$/, 'Caractères autorisés : lettres, chiffres, . _ -'),
  password: z.string().min(8, 'Au moins 8 caractères')
    .regex(/[A-Z]/, 'Doit contenir une majuscule')
    .regex(/[a-z]/, 'Doit contenir une minuscule')
    .regex(/[0-9]/, 'Doit contenir un chiffre'),
  telephone: z.string().max(32).optional().nullable(),
  email: z.string().email().optional().nullable().or(z.literal('')),
  roleId: z.enum(['ADMIN', 'FINANCE', 'ASSISTANT']),
  actif: z.boolean().optional().default(true),
});

// POST /api/users — création (assistant pharmacien, finance, admin)
router.post('/', validate(userSchema), asyncH(async (req, res) => {
  const d = req.validated;
  const exists = await prisma.user.findUnique({ where: { username: d.username } });
  if (exists) throw new ApiError(409, 'Ce nom d\'utilisateur existe déjà');
  const hash = await bcrypt.hash(d.password, 12);
  const user = await prisma.user.create({
    data: {
      nom: d.nom, prenom: d.prenom, username: d.username, passwordHash: hash,
      telephone: d.telephone || null, email: d.email || null,
      roleId: d.roleId, actif: d.actif,
    },
    include: { role: true },
  });
  await logAudit(prisma, {
    user: req.user, action: 'CREATE_USER', module: 'utilisateurs', ip: clientIp(req),
    description: `Création de l'utilisateur ${user.username} (${user.roleId})`,
    nouvelleValeur: publicUser(user),
  });
  res.status(201).json(publicUser(user));
}));

// PUT /api/users/:id
router.put('/:id', validate(userSchema.partial().omit({ password: true })), asyncH(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) throw new ApiError(404, 'Utilisateur introuvable');
  if (user.id === req.user.id && req.validated.actif === false) {
    throw new ApiError(400, 'Vous ne pouvez pas désactiver votre propre compte');
  }
  if (user.username === 'admin' && req.validated.roleId && req.validated.roleId !== 'ADMIN') {
    throw new ApiError(400, 'Le rôle du compte administrateur principal ne peut pas être modifié');
  }
  const before = publicUser(user);
  const updated = await prisma.user.update({
    where: { id },
    data: {
      nom: req.validated.nom ?? user.nom,
      prenom: req.validated.prenom ?? user.prenom,
      telephone: req.validated.telephone !== undefined ? req.validated.telephone : user.telephone,
      email: req.validated.email !== undefined ? (req.validated.email || null) : user.email,
      roleId: req.validated.roleId ?? user.roleId,
      actif: req.validated.actif ?? user.actif,
    },
    include: { role: true },
  });
  await logAudit(prisma, {
    user: req.user, action: 'UPDATE_USER', module: 'utilisateurs', ip: clientIp(req),
    description: `Modification de l'utilisateur ${updated.username}`,
    ancienneValeur: before, nouvelleValeur: publicUser(updated),
  });
  res.json(publicUser(updated));
}));

// POST /api/users/:id/reset-password
router.post('/:id/reset-password', validate(z.object({ newPassword: z.string().min(8) })), asyncH(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) throw new ApiError(404, 'Utilisateur introuvable');
  const hash = await bcrypt.hash(req.validated.newPassword, 12);
  await prisma.user.update({ where: { id }, data: { passwordHash: hash } });
  await logAudit(prisma, {
    user: req.user, action: 'RESET_PASSWORD', module: 'utilisateurs', ip: clientIp(req),
    description: `Réinitialisation du mot de passe de ${user.username}`,
  });
  res.json({ ok: true, message: 'Mot de passe réinitialisé' });
}));

// DELETE /api/users/:id — suppression sécurisée (désactivation si historique)
router.delete('/:id', asyncH(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (id === req.user.id) throw new ApiError(400, 'Vous ne pouvez pas supprimer votre propre compte');
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) throw new ApiError(404, 'Utilisateur introuvable');
  if (user.username === 'admin') throw new ApiError(400, 'Le compte administrateur principal ne peut pas être supprimé');
  const hasHistory = await prisma.vente.count({ where: { userId: id } })
    + await prisma.approvisionnement.count({ where: { userId: id } })
    + await prisma.inventaire.count({ where: { userId: id } });
  if (hasHistory > 0) {
    await prisma.user.update({ where: { id }, data: { actif: false } });
    await logAudit(prisma, { user: req.user, action: 'DEACTIVATE_USER', module: 'utilisateurs', ip: clientIp(req), description: `Désactivation de ${user.username} (historique conservé)` });
    return res.json({ ok: true, desactive: true, message: 'Utilisateur désactivé (historique des opérations conservé)' });
  }
  await prisma.user.delete({ where: { id } });
  await logAudit(prisma, { user: req.user, action: 'DELETE_USER', module: 'utilisateurs', ip: clientIp(req), description: `Suppression de ${user.username}` });
  res.json({ ok: true, message: 'Utilisateur supprimé' });
}));

// GET /api/users/roles — rôles et permissions
router.get('/roles/matrix', asyncH(async (req, res) => {
  const roles = await prisma.role.findMany({ include: { permissions: true } });
  res.json(roles);
}));

export default router;
