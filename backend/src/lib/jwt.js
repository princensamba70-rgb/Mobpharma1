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

function requestUsesHttps(req) {
  // trust proxy is enabled by the Express app, so req.secure also works when
  // TLS terminates at Nginx. Never use this to bypass certificate validation;
  // it only selects the correct cookie attributes for the already-used URL.
  return Boolean(req?.secure || String(req?.get?.('x-forwarded-proto') || '').split(',')[0].trim() === 'https');
}

/**
 * Refresh cookies must match the transport actually used by the client:
 * Secure is required for HTTPS and must be absent for an explicitly allowed
 * HTTP deployment. Native clients also receive a refresh token in their secure
 * store, so their authentication does not depend on third-party cookie rules.
 */
export function refreshCookieOptions(req) {
  const https = requestUsesHttps(req);
  const configuredSameSite = String(config.cookieSameSite || 'lax').toLowerCase();
  const sameSite = !https && configuredSameSite === 'none' ? 'lax' : configuredSameSite;
  return {
    httpOnly: true,
    sameSite,
    secure: https || config.cookieSecure,
    path: '/api/auth',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  };
}
