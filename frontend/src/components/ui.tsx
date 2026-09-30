import { ReactNode, useEffect } from 'react';
import { X, ChevronUp, ChevronDown, Loader2 } from 'lucide-react';
import { STATUT_COLORS } from '../lib/format';

export function Modal({ open, onClose, title, children, wide }: {
  open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; wide?: boolean;
}) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    if (open) window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className={`modal-panel ${wide ? 'max-w-4xl' : 'max-w-lg'}`} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 bg-gradient-to-r from-brand-50 to-white">
          <h3 className="font-bold text-slate-800">{title}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 rounded-lg p-1 hover:bg-slate-100">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  );
}

export function Badge({ statut, label }: { statut: string; label?: string }) {
  return <span className={`badge ${STATUT_COLORS[statut] || 'bg-slate-100 text-slate-600'}`}>{label || statut}</span>;
}

export function Spinner({ className = 'w-6 h-6' }: { className?: string }) {
  return <Loader2 className={`${className} animate-spin text-brand-600`} />;
}

export function Loading({ label = 'Chargement…' }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-slate-400">
      <Spinner className="w-8 h-8" />
      <p className="text-sm">{label}</p>
    </div>
  );
}

export function EmptyState({ icon, title, subtitle }: { icon?: ReactNode; title: string; subtitle?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-14 text-center">
      <div className="text-slate-300">{icon}</div>
      <p className="font-semibold text-slate-500">{title}</p>
      {subtitle && <p className="text-sm text-slate-400 max-w-sm">{subtitle}</p>}
    </div>
  );
}

export function SortHeader({ label, sortKey, current, dir, onSort }: {
  label: string; sortKey: string; current: string | null; dir: 'asc' | 'desc';
  onSort: (k: string) => void;
}) {
  const active = current === sortKey;
  return (
    <th className="th" onClick={() => onSort(sortKey)}>
      <span className="inline-flex items-center gap-1">
        {label}
        {active ? (dir === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)
          : <ChevronUpDown className="w-3 h-3 opacity-40" />}
      </span>
    </th>
  );
}
function ChevronUpDown(p: any) {
  return (
    <svg {...p} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="m7 15 5 5 5-5M7 9l5-5 5 5" />
    </svg>
  );
}

export function Pagination({ page, pageSize, total, onPage }: {
  page: number; pageSize: number; total: number; onPage: (p: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total === 0) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  const btns: number[] = [];
  const start = Math.max(1, Math.min(page - 2, pages - 4));
  for (let i = start; i <= Math.min(pages, start + 4); i++) btns.push(i);
  return (
    <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-4 py-3 border-t border-slate-200 bg-slate-50/50">
      <p className="text-xs text-slate-500">
        {from}–{to} sur <span className="font-semibold">{total}</span>
      </p>
      <div className="flex items-center gap-1">
        <button className="btn-secondary btn-sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>←</button>
        {btns.map((b) => (
          <button key={b} onClick={() => onPage(b)}
            className={`btn-sm rounded-lg px-3 py-1.5 text-xs font-medium ${b === page ? 'bg-brand-600 text-white' : 'bg-white border border-slate-300 text-slate-600 hover:bg-slate-50'}`}>
            {b}
          </button>
        ))}
        <button className="btn-secondary btn-sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>→</button>
      </div>
    </div>
  );
}

export function Tabs({ tabs, active, onChange }: {
  tabs: { id: string; label: ReactNode; count?: number }[]; active: string; onChange: (id: string) => void;
}) {
  return (
    <div className="flex gap-1 overflow-x-auto bg-slate-200/60 p-1 rounded-xl w-fit max-w-full">
      {tabs.map((t) => (
        <button key={t.id} onClick={() => onChange(t.id)}
          className={`px-3 sm:px-4 py-2 rounded-lg text-xs sm:text-sm font-medium whitespace-nowrap transition-all ${
            active === t.id ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-600 hover:text-slate-800'}`}>
          {t.label}
          {t.count !== undefined && <span className="ml-1.5 text-[10px] bg-slate-100 text-slate-500 rounded-full px-1.5 py-0.5">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Field({ label, children, required, className = '' }: {
  label: string; children: ReactNode; required?: boolean; className?: string;
}) {
  return (
    <div className={className}>
      <label className="label">{label}{required && <span className="text-red-500 ml-0.5">*</span>}</label>
      {children}
    </div>
  );
}

export function ConfirmDialog({ open, onClose, onConfirm, title, message, confirmLabel = 'Confirmer', danger }: {
  open: boolean; onClose: () => void; onConfirm: () => void;
  title: string; message: ReactNode; confirmLabel?: string; danger?: boolean;
}) {
  return (
    <Modal open={open} onClose={onClose} title={title}>
      <div className="text-sm text-slate-600 mb-5">{message}</div>
      <div className="flex justify-end gap-2">
        <button className="btn-secondary" onClick={onClose}>Annuler</button>
        <button className={danger ? 'btn-danger' : 'btn-primary'} onClick={() => { onConfirm(); onClose(); }}>{confirmLabel}</button>
      </div>
    </Modal>
  );
}
