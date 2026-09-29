// Utilitaires métier partagés
export const toNum = (v) => {
  if (v === null || v === undefined) return 0;
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : 0;
};

export const round2 = (n) => Math.round((toNum(n) + Number.EPSILON) * 100) / 100;

export function startOfDay(d = new Date()) {
  const x = new Date(d); x.setHours(0, 0, 0, 0); return x;
}
export function endOfDay(d = new Date()) {
  const x = new Date(d); x.setHours(23, 59, 59, 999); return x;
}
export function addDays(d, n) {
  const x = new Date(d); x.setDate(x.getDate() + n); return x;
}
export function dayKey(d) {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
}

// Statut de stock d'un médicament
export function stockStatus(med, expSoonDays = 90) {
  const stock = toNum(med.stock);
  const min = toNum(med.stockMinimal);
  const statuses = [];
  if (med.expirationProchaine) {
    const days = Math.floor((new Date(med.expirationProchaine) - new Date()) / 86400000);
    if (days < 0) statuses.push('EXPIRE');
    else if (days <= expSoonDays) statuses.push('EXPIRATION_PROCHE');
  }
  if (!med.actif) statuses.push('ARCHIVE');
  if (stock <= 0) statuses.push('EPUISE');
  else if (stock <= min) statuses.push('FAIBLE');
  else statuses.push('NORMAL');
  return statuses;
}

// Numéro de document séquentiel : FAC-2026-000001
export async function nextNumero(prisma, model, prefix, whereYear = {}) {
  const year = new Date().getFullYear();
  const count = await prisma[model].count({
    where: { numero: { startsWith: `${prefix}-${year}-` }, ...whereYear },
  });
  return `${prefix}-${year}-${String(count + 1).padStart(6, '0')}`;
}

// Journal d'audit
export async function logAudit(prisma, { user, action, module, description, ancienneValeur, nouvelleValeur, ip }) {
  try {
    await prisma.auditLog.create({
      data: {
        userId: user?.id ?? null,
        username: user?.username ?? 'system',
        action, module, description,
        ancienneValeur: ancienneValeur !== undefined ? JSON.stringify(ancienneValeur) : null,
        nouvelleValeur: nouvelleValeur !== undefined ? JSON.stringify(nouvelleValeur) : null,
        ip: ip || null,
      },
    });
  } catch (e) {
    console.error('Audit log error:', e.message);
  }
}

export function clientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  return (Array.isArray(xff) ? xff[0] : xff)?.split(',')[0]?.trim() || req.ip || req.socket?.remoteAddress || null;
}

// Échappement XSS basique pour valeurs réinjectées
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export const MODES_PAIEMENT = ['ESPECES', 'MOBILE_MONEY', 'CARTE', 'CREDIT'];
