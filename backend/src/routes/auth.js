import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { signAccessToken, signRefreshToken, verifyRefreshToken, refreshCookieOptions } from '../lib/jwt.js';
import { authenticate } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { asyncH, ApiError } from '../middleware/error.js';
import { logAudit, clientIp } from '../lib/utils.js';
import { PERMISSIONS } from '../config.js';

const router = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de tentatives de connexion. Réessayez dans 15 minutes.' },
});

const publicUser = (u) => ({
  id: u.id, nom: u.nom, prenom: u.prenom, username: u.username,
  telephone: u.telephone, email: u.email, roleId: u.roleId,
  roleName: u.role?.nom || u.roleId, actif: u.actif,
  permissions: PERMISSIONS[u.roleId] || {},
});

function isNativeClient(req) {
  return ['android', 'ios', 'mobile'].includes(String(req.get('X-Client-Platform') || '').toLowerCase());
}

// POST /api/auth/login
router.post('/login', loginLimiter, validate(z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(1).max(128),
})), asyncH(async (req, res) => {
  const { username, password } = req.validated;
  const user = await prisma.user.findUnique({ where: { username }, include: { role: true } });
  if (!user) {
    await logAudit(prisma, { action: 'LOGIN_FAILED', module: 'auth', description: `Échec de connexion : ${username}`, ip: clientIp(req) });
    throw new ApiError(401, 'Identifiants incorrects');
  }
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) {
    await logAudit(prisma, { user, action: 'LOGIN_FAILED', module: 'auth', description: 'Mot de passe incorrect', ip: clientIp(req) });
    throw new ApiError(401, 'Identifiants incorrects');
  }
  if (!user.actif) throw new ApiError(403, 'Ce compte est désactivé. Contactez l\'administrateur.');

  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  await logAudit(prisma, { user, action: 'LOGIN', module: 'auth', description: 'Connexion réussie', ip: clientIp(req) });

  const accessToken = signAccessToken(user);
  const refreshToken = signRefreshToken(user);
  res.cookie('refreshToken', refreshToken, refreshCookieOptions);

  const response = { accessToken, user: publicUser(user) };
  // Browsers keep refresh tokens in an httpOnly cookie. Native clients receive
  // the refresh token over HTTPS and store it through Android Keystore; it is
  // never written to ordinary WebView storage or exposed in application logs.
  if (isNativeClient(req)) response.refreshToken = refreshToken;
  res.json(response);
}));

// POST /api/auth/refresh
router.post('/refresh', asyncH(async (req, res) => {
  const token = req.cookies?.refreshToken || req.body?.refreshToken || req.get('X-Refresh-Token');
  if (!token) throw new ApiError(401, 'Refresh token manquant');
  const payload = verifyRefreshToken(token);
  const user = await prisma.user.findUnique({ where: { id: payload.sub }, include: { role: true } });
  if (!user || !user.actif) throw new ApiError(401, 'Compte invalide');
  const accessToken = signAccessToken(user);
  const response = { accessToken, user: publicUser(user) };
  if (isNativeClient(req)) {
    // Rotate the native refresh token and keep the old one out of the client.
    const nextRefreshToken = signRefreshToken(user);
    response.refreshToken = nextRefreshToken;
    res.cookie('refreshToken', nextRefreshToken, refreshCookieOptions);
  }
  res.json(response);
}));

// POST /api/auth/logout
router.post('/logout', authenticate, asyncH(async (req, res) => {
  await logAudit(prisma, { user: req.user, action: 'LOGOUT', module: 'auth', description: 'Déconnexion', ip: clientIp(req) });
  res.clearCookie('refreshToken', { path: '/api/auth' });
  res.json({ ok: true });
}));

// GET /api/auth/me
router.get('/me', authenticate, asyncH(async (req, res) => {
  res.json({ user: publicUser(req.user) });
}));

// POST /api/auth/change-password
router.post('/change-password', authenticate, validate(z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8, 'Le mot de passe doit contenir au moins 8 caractères')
    .regex(/[A-Z]/, 'Doit contenir une majuscule')
    .regex(/[a-z]/, 'Doit contenir une minuscule')
    .regex(/[0-9]/, 'Doit contenir un chiffre'),
})), asyncH(async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  const ok = await bcrypt.compare(req.validated.currentPassword, user.passwordHash);
  if (!ok) throw new ApiError(400, 'Mot de passe actuel incorrect');
  const hash = await bcrypt.hash(req.validated.newPassword, 12);
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash: hash } });
  await logAudit(prisma, { user: req.user, action: 'CHANGE_PASSWORD', module: 'auth', description: 'Mot de passe modifié', ip: clientIp(req) });
  res.json({ ok: true, message: 'Mot de passe modifié avec succès' });
}));

export default router;
