import { useCallback, useEffect, useState } from 'react';
import { Search, ScrollText } from 'lucide-react';
import { api } from '../api/client';
import { useToast } from '../context/ToastContext';
import { fmtDateTime } from '../lib/format';
import { Loading, Pagination } from '../components/ui';
import { ExportButtons } from '../components/ExportButtons';

const ACTION_COLORS: Record<string, string> = {
  LOGIN: 'bg-emerald-100 text-emerald-700', LOGOUT: 'bg-slate-100 text-slate-600',
  LOGIN_FAILED: 'bg-red-100 text-red-700',
  CREATE_VENTE: 'bg-brand-100 text-brand-700', ANNULER_VENTE: 'bg-red-100 text-red-700',
  CREATE_APPROVISIONNEMENT: 'bg-violet-100 text-violet-700', ANNULER_APPROVISIONNEMENT: 'bg-red-100 text-red-700',
  CREATE_MEDICAMENT: 'bg-sky-100 text-sky-700', UPDATE_MEDICAMENT: 'bg-amber-100 text-amber-700',
  ARCHIVE_MEDICAMENT: 'bg-orange-100 text-orange-700', DELETE_MEDICAMENT: 'bg-red-100 text-red-700',
  AJUSTEMENT_STOCK: 'bg-amber-100 text-amber-700',
  CREATE_INVENTAIRE: 'bg-sky-100 text-sky-700', VALIDATE_INVENTAIRE: 'bg-emerald-100 text-emerald-700',
  CREATE_USER: 'bg-sky-100 text-sky-700', UPDATE_USER: 'bg-amber-100 text-amber-700',
  DELETE_USER: 'bg-red-100 text-red-700', DEACTIVATE_USER: 'bg-red-100 text-red-700',
  RESET_PASSWORD: 'bg-amber-100 text-amber-700', CHANGE_PASSWORD: 'bg-amber-100 text-amber-700',
  UPDATE_SETTINGS: 'bg-slate-200 text-slate-700', IMPORT_CATALOG: 'bg-violet-100 text-violet-700',
};

export default function Audit() {
  const { toast } = useToast();
  const [q, setQ] = useState('');
  const [mod, setMod] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<any>(null);
  const [detail, setDetail] = useState<any>(null);
  const pageSize = 30;

  const load = useCallback(() => {
    const qs = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (q) qs.set('q', q);
    if (mod) qs.set('module', mod);
    api.get(`/api/audit?${qs}`).then(setData).catch((e) => toast('error', e.message));
  }, [page, q, mod]);

  useEffect(() => { const t = setTimeout(load, q ? 250 : 0); return () => clearTimeout(t); }, [load, q, mod]);

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-800 flex items-center gap-2">
            <ScrollText className="w-6 h-6 text-brand-600" /> Journal d'audit
          </h1>
          <p className="text-sm text-slate-500">Traçabilité complète des opérations ({data?.total ?? '…'} entrées)</p>
        </div>
        <ExportButtons what="audit" params={{ q: q || undefined }} />
      </div>

      <div className="card p-4 flex flex-col md:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input className="input pl-9" placeholder="Rechercher : action, description, utilisateur…"
            value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
        </div>
        <select className="input md:w-56" value={mod} onChange={(e) => { setMod(e.target.value); setPage(1); }}>
          <option value="">Tous les modules</option>
          {(data?.modules || []).map((m: string) => <option key={m} value={m}>{m}</option>)}
        </select>
      </div>

      {!data ? <Loading /> : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="th-static">Date / Heure</th><th className="th-static">Utilisateur</th>
                  <th className="th-static">Action</th><th className="th-static">Module</th>
                  <th className="th-static">Description</th><th className="th-static">IP</th>
                  <th className="th-static w-16">Détail</th>
                </tr>
              </thead>
              <tbody>
                {data.items.length === 0 && <tr><td colSpan={7} className="td text-center py-10 text-slate-400">Aucune entrée</td></tr>}
                {data.items.map((l: any) => (
                  <tr key={l.id} className="tr-hover">
                    <td className="td text-xs whitespace-nowrap">{fmtDateTime(l.createdAt)}</td>
                    <td className="td font-mono text-xs">@{l.username || '—'}</td>
                    <td className="td"><span className={`badge ${ACTION_COLORS[l.action] || 'bg-slate-100 text-slate-600'}`}>{l.action}</span></td>
                    <td className="td text-xs">{l.module}</td>
                    <td className="td text-xs max-w-[380px] truncate" title={l.description}>{l.description || '—'}</td>
                    <td className="td text-xs text-slate-400 font-mono">{l.ip || '—'}</td>
                    <td className="td">
                      {(l.ancienneValeur || l.nouvelleValeur) && (
                        <button className="text-xs font-semibold text-brand-600 hover:underline" onClick={() => setDetail(l)}>voir</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
        </div>
      )}

      {detail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" onClick={() => setDetail(null)}>
          <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full p-5 max-h-[80vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-bold mb-3">{detail.action} — {detail.module}</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
              <div>
                <p className="font-bold text-red-600 mb-1">Ancienne valeur</p>
                <pre className="bg-red-50 rounded-lg p-3 overflow-auto max-h-52">{detail.ancienneValeur ? JSON.stringify(JSON.parse(detail.ancienneValeur), null, 2) : '—'}</pre>
              </div>
              <div>
                <p className="font-bold text-emerald-600 mb-1">Nouvelle valeur</p>
                <pre className="bg-emerald-50 rounded-lg p-3 overflow-auto max-h-52">{detail.nouvelleValeur ? JSON.stringify(JSON.parse(detail.nouvelleValeur), null, 2) : '—'}</pre>
              </div>
            </div>
            <div className="flex justify-end mt-4"><button className="btn-secondary btn-sm" onClick={() => setDetail(null)}>Fermer</button></div>
          </div>
        </div>
      )}
    </div>
  );
}
