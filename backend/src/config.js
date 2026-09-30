// Configuration centrale de l'API AMI PHARMA
import 'dotenv/config';
import { randomBytes } from 'crypto';

const nodeEnv = process.env.NODE_ENV || 'development';

function secretFromEnv(name) {
  const value = process.env[name];
  if (value && value.length >= 32) return value;
  if (nodeEnv === 'production') {
    throw new Error(`${name} doit être défini avec au moins 32 caractères en production.`);
  }
  // Development-only ephemeral secret: it changes at every local server start,
  // which is safer than shipping a reusable secret in the repository.
  return randomBytes(48).toString('hex');
}

const rawCors = process.env.CORS_ORIGIN;
const corsOrigin = rawCors || (nodeEnv === 'production'
  ? 'https://localhost,capacitor://localhost'
  : '*');

export const config = {
  port: parseInt(process.env.PORT || '4000', 10),
  nodeEnv,
  jwt: {
    accessSecret: secretFromEnv('JWT_ACCESS_SECRET'),
    refreshSecret: secretFromEnv('JWT_REFRESH_SECRET'),
    accessTtl: process.env.JWT_ACCESS_TTL || '2h',
    refreshTtl: process.env.JWT_REFRESH_TTL || '7d',
  },
  corsOrigin,
  cookieSecure: process.env.COOKIE_SECURE === 'true',
  cookieSameSite: process.env.COOKIE_SAMESITE || 'lax',
  currency: process.env.CURRENCY || 'CDF',
  locale: process.env.LOCALE || 'fr-FR',
  pharmacy: {
    nom: 'AMI PHARMA',
    slogan: 'Système intégré de gestion de pharmacie',
    adresse: 'AVENUE NGUMA N° 3 Q/JOLI PARC C/NGALIEMA',
    ville: 'KINSHASA / RDC',
    telephone: '0820829592 - 0812271621',
  },
};

// Matrice de permissions par rôle (module → full | read | none)
export const PERMISSIONS = {
  ADMIN: {
    dashboard: 'full', approvisionnement: 'full', facturation: 'full',
    rapportJournalier: 'full', stock: 'full', inventaire: 'full',
    finance: 'full', utilisateurs: 'full', parametres: 'full',
    rapports: 'full', audit: 'full', medicaments: 'full', fournisseurs: 'full',
    catalogue: 'full',
  },
  FINANCE: {
    dashboard: 'read', approvisionnement: 'read', facturation: 'read',
    rapportJournalier: 'read', stock: 'read', inventaire: 'read',
    finance: 'full', utilisateurs: 'none', parametres: 'none',
    rapports: 'read', audit: 'none', medicaments: 'read', fournisseurs: 'read',
    catalogue: 'read',
  },
  ASSISTANT: {
    dashboard: 'read', approvisionnement: 'none', facturation: 'full',
    rapportJournalier: 'full', stock: 'full', inventaire: 'full',
    finance: 'none', utilisateurs: 'none', parametres: 'none',
    rapports: 'read', audit: 'none', medicaments: 'read', fournisseurs: 'none',
    catalogue: 'read',
  },
};

export const ROLES = { ADMIN: 'ADMIN', FINANCE: 'FINANCE', ASSISTANT: 'ASSISTANT' };
