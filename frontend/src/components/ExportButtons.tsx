import { useState } from 'react';
import { FileSpreadsheet, FileText, FileCode, Printer } from 'lucide-react';
import { downloadExport } from '../api/client';
import { useToast } from '../context/ToastContext';

// Boutons d'export : 🟢 Excel — 🔴 PDF — ⚪ CSV — 🖨️ Imprimer
export function ExportButtons({ what, params = {}, printId, compact }: {
  what: string; params?: Record<string, string | number | undefined>;
  printId?: string; compact?: boolean;
}) {
  const { toast } = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== '') as any).toString();
  const url = (fmt: string) => `/api/exports/${what}?format=${fmt}${qs ? '&' + qs : ''}`;

  const dl = async (fmt: string, ext: string) => {
    setBusy(fmt);
    try {
      await downloadExport(url(fmt), `${what}-${new Date().toISOString().slice(0, 10)}.${ext}`);
      toast('success', `Export ${ext.toUpperCase()} téléchargé`);
    } catch (e: any) {
      toast('error', e.message || 'Échec de l\'export');
    } finally { setBusy(null); }
  };

  const btn = 'btn-sm rounded-lg border font-medium inline-flex items-center gap-1.5 disabled:opacity-50 px-2.5 py-1.5';
  return (
    <div className={`flex items-center gap-1.5 flex-wrap ${compact ? '' : ''}`}>
      <button className={`${btn} bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100`}
        disabled={busy === 'xlsx'} onClick={() => dl('xlsx', 'xlsx')} title="Exporter Excel">
        <FileSpreadsheet className="w-3.5 h-3.5" />{!compact && 'Excel'}
      </button>
      <button className={`${btn} bg-red-50 border-red-200 text-red-700 hover:bg-red-100`}
        disabled={busy === 'pdf'} onClick={() => dl('pdf', 'pdf')} title="Exporter PDF">
        <FileText className="w-3.5 h-3.5" />{!compact && 'PDF'}
      </button>
      <button className={`${btn} bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100`}
        disabled={busy === 'csv'} onClick={() => dl('csv', 'csv')} title="Exporter CSV">
        <FileCode className="w-3.5 h-3.5" />{!compact && 'CSV'}
      </button>
      {printId && (
        <button className={`${btn} bg-sky-50 border-sky-200 text-sky-700 hover:bg-sky-100`}
          onClick={() => window.print()} title="Imprimer">
          <Printer className="w-3.5 h-3.5" />{!compact && 'Imprimer'}
        </button>
      )}
    </div>
  );
}
