// Formats FR / CDF
export const fmtMoney = (n: number | string | null | undefined, currency = 'CDF') => {
  const v = typeof n === 'number' ? n : parseFloat(String(n ?? '0'));
  return `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(Number.isFinite(v) ? v : 0)} ${currency}`;
};
export const fmtNum = (n: number | string | null | undefined) => {
  const v = typeof n === 'number' ? n : parseFloat(String(n ?? '0'));
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(Number.isFinite(v) ? v : 0);
};
export const fmtDate = (d: string | Date | null | undefined) =>
  d ? new Date(d).toLocaleDateString('fr-FR') : '—';
export const fmtDateTime = (d: string | Date | null | undefined) =>
  d ? new Date(d).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '—';
export const fmtTime = (d: string | Date | null | undefined) =>
  d ? new Date(d).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '—';
export const todayISO = () => new Date().toISOString().slice(0, 10);

export const STATUT_COLORS: Record<string, string> = {
  NORMAL: 'bg-emerald-100 text-emerald-700',
  FAIBLE: 'bg-amber-100 text-amber-700',
  EPUISE: 'bg-red-100 text-red-700',
  EXPIRATION_PROCHE: 'bg-orange-100 text-orange-700',
  EXPIRE: 'bg-red-200 text-red-800',
  ARCHIVE: 'bg-slate-200 text-slate-600',
  VALIDEE: 'bg-emerald-100 text-emerald-700',
  VALIDE: 'bg-emerald-100 text-emerald-700',
  ANNULEE: 'bg-red-100 text-red-700',
  ANNULE: 'bg-red-100 text-red-700',
  EN_COURS: 'bg-sky-100 text-sky-700',
  URGENT: 'bg-red-100 text-red-700',
  ELEVE: 'bg-amber-100 text-amber-700',
  ESPECES: 'bg-emerald-100 text-emerald-700',
  MOBILE_MONEY: 'bg-sky-100 text-sky-700',
  CARTE: 'bg-violet-100 text-violet-700',
  CREDIT: 'bg-orange-100 text-orange-700',
};
