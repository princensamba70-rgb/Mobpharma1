import jwt from 'jsonwebtoken';
import { config } from '../config.js';

export function signAccessToken(user) {
  return jwt.sign(
    { sub: user.id, username: user.username, roleId: user.roleId },
    config.jwt.accessSecret,
    { expiresIn: config.jwt.accessTtl }
  );
}

export function signRefreshToken(user) {
  return jwt.sign({ sub: user.id, type: 'refresh' }, config.jwt.refreshSecret, {
    expiresIn: config.jwt.refreshTtl,
  });
}

export function verifyAccessToken(token) {
  return jwt.verify(token, config.jwt.accessSecret);
}

export function verifyRefreshToken(token) {
  const payload = jwt.verify(token, config.jwt.refreshSecret);
  if (payload?.type !== 'refresh') throw new Error('Type de jeton invalide');
  return payload;
}

export const refreshCookieOptions = {
  httpOnly: true,
  sameSite: config.cookieSameSite,
  secure: config.cookieSecure || (config.nodeEnv === 'production' && config.cookieSameSite === 'none'),
  path: '/api/auth',
  maxAge: 7 * 24 * 60 * 60 * 1000,
};
