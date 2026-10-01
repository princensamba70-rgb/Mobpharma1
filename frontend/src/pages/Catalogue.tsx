import { useCallback, useEffect, useState } from 'react';
import { Search, Upload, BookOpenCheck } from 'lucide-react';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { fmtMoney } from '../lib/format';
import { Loading, Pagination } from '../components/ui';
import { ExportButtons } from '../components/ExportButtons';
import { getLocalCataloguePage, saveCatalogue } from '../lib/offlineDb';

export default function Catalogue() {
  const { can } = useAuth();
  const { toast } = useToast();
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<any>(null);
  const [importing, setImporting] = useState(false);
  const pageSize = 25;

  const load = useCallback(async () => {
    const local = await getLocalCataloguePage(q, page, pageSize).catch(() => null);
    if (local && (typeof navigator === 'undefined' || navigator.onLine === false || local.items.length > 0)) setData(local);
    const qs = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (q) qs.set('q', q);
    try {
      const remote = await api.get(`/api/catalog?${qs}`);
      await saveCatalogue(remote.items || []).catch(() => {});
      setData(remote);
    } catch (error: any) {
      if (!local) toast('error', error.message);
    }
  }, [page, q]);

  useEffect(() => { const t = setTimeout(load, q ? 250 : 0); return () => clearTimeout(t); }, [load, q]);

  const importer = async () => {
    setImporting(true);
    try {
      const r = await api.post('/api/catalog/import');
      toast('success', `Catalogue actualisé : ${r.created} créés, ${r.updated} mis à jour (total ${r.total})`);
      load();
    } catch (e: any) { toast('error', e.message); } finally { setImporting(false); }
  };

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-800 flex items-center gap-2">
            <BookOpenCheck className="w-6 h-6 text-brand-600" /> Catalogue des prix
          </h1>
          <p className="text-sm text-slate-500">
            Liste officielle importée du PDF « LISTE DES PRIX(1).pdf » — édition du 24/07/2026 — devise CDF ({data?.total ?? '…'} produits)
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <ExportButtons what="catalogue" />
          {can('catalogue', 'full') && (
            <button className="btn-primary" onClick={importer} disabled={importing}>
              <Upload className="w-4 h-4" /> {importing ? 'Import en cours…' : 'Importer / actualiser le catalogue'}
            </button>
          )}
        </div>
      </div>

      <div className="card p-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input className="input pl-9" placeholder="Rechercher dans le catalogue : code, désignation, emballage… (ex : amoxi, augmentin, 1005)"
            value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
        </div>
      </div>

      {!data ? <Loading /> : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="th-static">N°</th><th className="th-static">Code</th>
                  <th className="th-static">Désignation</th><th className="th-static">Emb.</th>
                  <th className="th-static text-right">Prix (CDF)</th><th className="th-static">Devise</th>
                </tr>
              </thead>
              <tbody>
                {data.items.length === 0 && <tr><td colSpan={6} className="td text-center py-10 text-slate-400">Aucun produit trouvé</td></tr>}
                {data.items.map((c: any) => (
                  <tr key={c.id} className="tr-hover">
                    <td className="td text-xs text-slate-400">{c.numero}</td>
                    <td className="td font-mono text-xs font-bold text-brand-700">{c.code}</td>
                    <td className="td font-medium max-w-[380px] truncate" title={c.designation}>{c.designation}</td>
                    <td className="td text-xs">{c.emballage || '—'}</td>
                    <td className="td text-right font-bold">
                      {c.prix > 0 ? fmtMoney(c.prix) : <span className="text-red-500 font-semibold text-xs">Prix = 0 CDF</span>}
                    </td>
                    <td className="td text-xs text-slate-400">{c.devise}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
        </div>
      )}
    </div>
  );
}
