import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authenticate, requirePerm } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { asyncH } from '../middleware/error.js';
import { logAudit, clientIp } from '../lib/utils.js';
import { config } from '../config.js';
import { invalidateSettingsCache } from '../lib/stats.js';

const router = Router();

// GET /api/settings — lecture publique authentifiée (infos pharmacie + seuils)
router.get('/', authenticate, asyncH(async (req, res) => {
  const rows = await prisma.setting.findMany();
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  res.json({
    pharmacie: {
      nom: map['pharmacie.nom'] || config.pharmacy.nom,
      slogan: map['pharmacie.slogan'] || config.pharmacy.slogan,
      adresse: map['pharmacie.adresse'] || config.pharmacy.adresse,
      ville: map['pharmacie.ville'] || config.pharmacy.ville,
      telephone: map['pharmacie.telephone'] || config.pharmacy.telephone,
    },
    expirationSeuils: (map['expiration.seuils'] || '180,90,60,30').split(',').map(Number),
    reapproFacteur: Number(map['reappro.facteur'] || 2),
    devise: map['devise'] || 'CDF',
    langue: map['langue'] || 'fr',
  });
}));

// PUT /api/settings — modification réservée à l'ADMIN
router.put('/', authenticate, requirePerm('parametres', 'full'), validate(z.object({
  pharmacie: z.object({
    nom: z.string().max(120).optional(),
    slogan: z.string().max(200).optional(),
    adresse: z.string().max(200).optional(),
    ville: z.string().max(120).optional(),
    telephone: z.string().max(64).optional(),
  }).optional(),
  expirationSeuils: z.array(z.number().int().min(1).max(720)).max(8).optional(),
  reapproFacteur: z.number().min(1).max(10).optional(),
  devise: z.string().max(8).optional(),
  langue: z.string().max(8).optional(),
})), asyncH(async (req, res) => {
  const d = req.validated;
  const upserts = [];
  if (d.pharmacie) {
    for (const [k, v] of Object.entries(d.pharmacie)) {
      if (v !== undefined) upserts.push({ key: `pharmacie.${k}`, value: String(v) });
    }
  }
  if (d.expirationSeuils) upserts.push({ key: 'expiration.seuils', value: d.expirationSeuils.sort((a, b) => b - a).join(',') });
  if (d.reapproFacteur) upserts.push({ key: 'reappro.facteur', value: String(d.reapproFacteur) });
  if (d.devise) upserts.push({ key: 'devise', value: d.devise });
  if (d.langue) upserts.push({ key: 'langue', value: d.langue });

  for (const u of upserts) {
    await prisma.setting.upsert({ where: { key: u.key }, create: u, update: { value: u.value } });
  }
  invalidateSettingsCache();
  await logAudit(prisma, { user: req.user, action: 'UPDATE_SETTINGS', module: 'parametres', ip: clientIp(req), description: 'Modification des paramètres', nouvelleValeur: d });
  res.json({ ok: true, message: 'Paramètres enregistrés' });
}));

export default router;
