import { ReactNode } from 'react';

export function StatCard({ icon, label, value, sub, accent = 'teal', onClick }: {
  icon: ReactNode; label: string; value: ReactNode; sub?: ReactNode;
  accent?: 'teal' | 'blue' | 'amber' | 'red' | 'green' | 'violet' | 'orange' | 'slate';
  onClick?: () => void;
}) {
  const accents: Record<string, string> = {
    teal: 'bg-brand-100 text-brand-700',
    blue: 'bg-sky-100 text-sky-700',
    amber: 'bg-amber-100 text-amber-700',
    red: 'bg-red-100 text-red-700',
    green: 'bg-emerald-100 text-emerald-700',
    violet: 'bg-violet-100 text-violet-700',
    orange: 'bg-orange-100 text-orange-700',
    slate: 'bg-slate-100 text-slate-600',
  };
  return (
    <div className={`stat-card ${onClick ? 'cursor-pointer' : ''}`} onClick={onClick}>
      <div className={`rounded-xl p-2.5 ${accents[accent]}`}>{icon}</div>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-slate-500 truncate">{label}</p>
        <p className="text-lg sm:text-xl font-bold text-slate-800 truncate mt-0.5">{value}</p>
        {sub && <p className="text-[11px] text-slate-400 mt-0.5 truncate">{sub}</p>}
      </div>
    </div>
  );
}
