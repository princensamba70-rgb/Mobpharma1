import { verifyAccessToken } from '../lib/jwt.js';
import { prisma } from '../lib/prisma.js';
import { PERMISSIONS } from '../config.js';

// Authentification JWT (Bearer)
export async function authenticate(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Authentification requise' });
    const payload = verifyAccessToken(token);
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      include: { role: true },
    });
    if (!user || !user.actif) return res.status(401).json({ error: 'Compte introuvable ou désactivé' });
    req.user = user;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Session expirée, veuillez vous reconnecter' });
  }
}

// Contrôle d'accès basé sur les rôles : requirePerm('facturation', 'full'|'read')
export function requirePerm(module, niveau = 'full') {
  return (req, res, next) => {
    const role = req.user?.roleId;
    const matrix = PERMISSIONS[role];
    if (!matrix) return res.status(403).json({ error: 'Accès refusé' });
    const perm = matrix[module] || 'none';
    const ok = niveau === 'read' ? perm !== 'none' : perm === 'full';
    if (!ok) return res.status(403).json({ error: `Accès refusé : permission "${module}" insuffisante pour le rôle ${role}` });
    next();
  };
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user?.roleId)) return res.status(403).json({ error: 'Accès réservé' });
    next();
  };
}
