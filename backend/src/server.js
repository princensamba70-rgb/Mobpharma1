import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from './config.js';
import { notFound, errorHandler } from './middleware/error.js';

import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import medicamentRoutes from './routes/medicaments.js';
import catalogRoutes from './routes/catalog.js';
import fournisseurRoutes from './routes/fournisseurs.js';
import approvisionnementRoutes from './routes/approvisionnements.js';
import venteRoutes from './routes/ventes.js';
import stockRoutes from './routes/stock.js';
import inventaireRoutes from './routes/inventaires.js';
import rapportRoutes from './routes/rapports.js';
import dashboardRoutes from './routes/dashboard.js';
import notificationRoutes from './routes/notifications.js';
import auditRoutes from './routes/audit.js';
import settingRoutes from './routes/settings.js';
import exportRoutes from './routes/exports.js';

const app = express();

app.set('trust proxy', 1);
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
const allowedOrigins = config.corsOrigin === '*'
  ? null
  : config.corsOrigin.split(',').map((origin) => origin.trim()).filter(Boolean);

app.use(cors({
  origin(origin, callback) {
    // Native Capacitor requests use https://localhost (or capacitor://localhost)
    // and are explicitly allowed by the production default. Non-browser tools
    // such as health checks have no Origin and remain supported.
    if (!origin || !allowedOrigins || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error('Origine CORS non autorisée'));
  },
  credentials: true,
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Client-Platform', 'X-Refresh-Token'],
  methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
}));
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());

// Rate limiting global API
app.use('/api', rateLimit({ windowMs: 60 * 1000, max: 600, standardHeaders: true, legacyHeaders: false }));

app.get('/api/health', (req, res) => res.json({ ok: true, app: 'AMI PHARMA API', time: new Date().toISOString() }));

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/medicaments', medicamentRoutes);
app.use('/api/catalog', catalogRoutes);
app.use('/api/fournisseurs', fournisseurRoutes);
app.use('/api/approvisionnements', approvisionnementRoutes);
app.use('/api/ventes', venteRoutes);
app.use('/api/stock', stockRoutes);
app.use('/api/inventaires', inventaireRoutes);
app.use('/api/rapports', rapportRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/audit', auditRoutes);
app.use('/api/settings', settingRoutes);
app.use('/api/exports', exportRoutes);

app.use('/api', notFound);

// Filet de sécurité : si le frontend est buildé (frontend/dist), l'API le sert aussi.
// L'application complète tourne alors sur UN SEUL port (4000) — en production Docker,
// c'est Nginx qui sert les statiques (ce bloc est inactif si dist est absent).
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(__dirname, '..', '..', 'frontend', 'dist');
if (existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get('*', (req, res) => res.sendFile(path.join(distDir, 'index.html')));
  console.log('✔ Frontend statique servi depuis frontend/dist (application complète sur ce port)');
}

app.use(errorHandler);

app.listen(config.port, '0.0.0.0', () => {
  console.log(`✔ AMI PHARMA API démarrée sur http://0.0.0.0:${config.port} (${config.nodeEnv})`);
});

// Sécurité processus : une promesse rejetée ne doit pas tuer le serveur silencieusement
process.on('unhandledRejection', (reason) => {
  console.error('⚠ unhandledRejection:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('✖ uncaughtException:', err);
});
