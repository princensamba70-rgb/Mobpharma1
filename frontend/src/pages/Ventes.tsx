import { useCallback, useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Search, Eye, Ban, Printer, ReceiptText, ChevronLeft } from 'lucide-react';
import { ApiError, api, downloadExport } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { fmtMoney, fmtDate, fmtDateTime, todayISO } from '../lib/format';
import { getLocalInvoice, getLocalInvoicesPage, saveServerInvoices } from '../lib/offlineDb';
import { Loading, Badge, Modal, Pagination,  ConfirmDialog } from '../components/ui';
import { ExportButtons } from '../components/ExportButtons';
import { FacturePrint } from './Facturation';

export default function Ventes({ detail }: { detail?: boolean }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const { can } = useAuth();
  const { toast } = useToast();

  const [filters, setFilters] = useState({ q: '', from: '', to: '', statut: '' });
  const [page, setPage] = useState(1);
  const [data, setData] = useState<any>(null);
  const [vente, setVente] = useState<any>(null);
  const [annulTarget, setAnnulTarget] = useState<any>(null);
  const [motif, setMotif] = useState('');

  const pageSize = 20;
  const load = useCallback(async () => {
    const localFilters = { q: filters.q, from: filters.from, to: filters.to, statut: filters.statut };
    const local = await getLocalInvoicesPage(localFilters, page, pageSize).catch(() => null);
    if (local && (typeof navigator === 'undefined' || navigator.onLine === false || local.items.some((item: any) => item.syncStatus !== 'SYNCED'))) setData(local);
    const qs = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    Object.entries(filters).forEach(([k, v]) => v && qs.set(k, v));
    try {
      const remote = await api.get(`/api/ventes?${qs}`);
      await saveServerInvoices(remote.items || []).catch(() => {});
      const pending = (local?.items || []).filter((item: any) => item.syncStatus !== 'SYNCED' && !remote.items.some((r: any) => r.syncId === item.syncId));
      setData({ ...remote, items: [...pending, ...remote.items] });
    } catch (error: any) {
      if (!local) toast('error', error.message);
    }
  }, [page, filters]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    let active = true;
    if (detail && id) {
      void (async () => {
        const local = await getLocalInvoice(id).catch(() => undefined);
        if (active && local) setVente(local);
        try {
          const remote = await api.get(`/api/ventes/${id}`);
          if (active) setVente(remote);
        } catch (error: any) {
          if (active && !local && !(error instanceof ApiError && error.status === 0)) toast('error', error.message);
        }
      })();
    } else setVente(null);
    return () => { active = false; };
  }, [detail, id]);

  const annuler = async () => {
    try {
      await api.post(`/api/ventes/${annulTarget.id}/annuler`, { motif });
      toast('success', 'Vente annulée — stock restauré');
      setMotif(''); load();
      if (vente) api.get(`/api/ventes/${vente.id}`).then(setVente);
    } catch (e: any) { toast('error', e.message); }
  };

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          {detail && <button className="btn-secondary btn-sm" onClick={() => navigate('/ventes')}><ChevronLeft className="w-4 h-4" /> Retour</button>}
          <div>
            <h1 className="text-2xl font-extrabold text-slate-800">Ventes</h1>
            <p className="text-sm text-slate-500">Historique des factures</p>
          </div>
        </div>
        <ExportButtons what="ventes" params={{ from: filters.from, to: filters.to, statut: filters.statut || undefined }} />
      </div>

      {!detail && (
        <>
          <div className="card p-4 flex flex-col lg:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input className="input pl-9" placeholder="Rechercher n° facture ou caissier…" value={filters.q}
                onChange={(e) => { setFilters({ ...filters, q: e.target.value }); setPage(1); }} />
            </div>
            <input type="date" className="input lg:w-44" value={filters.from} onChange={(e) => { setFilters({ ...filters, from: e.target.value }); setPage(1); }} />
            <input type="date" className="input lg:w-44" value={filters.to} onChange={(e) => { setFilters({ ...filters, to: e.target.value }); setPage(1); }} />
            <select className="input lg:w-40" value={filters.statut} onChange={(e) => { setFilters({ ...filters, statut: e.target.value }); setPage(1); }}>
              <option value="">Tous statuts</option>
              <option value="VALIDEE">Validées</option>
              <option value="ANNULEE">Annulées</option>
            </select>
            <button className="btn-secondary" onClick={() => { setFilters({ q: '', from: '', to: '', statut: '' }); setPage(1); }}>Réinitialiser</button>
          </div>

          {!data ? <Loading /> : (
            <div className="card overflow-hidden">
              {data.totalMontant > 0 && (
                <div className="px-4 py-2.5 bg-brand-50/60 border-b border-brand-100 text-sm text-brand-800 font-semibold">
                  Total de la sélection : {fmtMoney(data.totalMontant)}
                </div>
              )}
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr>
                      <th className="th-static">N° Facture</th><th className="th-static">Date / Heure</th>
                      <th className="th-static">Caissier</th><th className="th-static">Lignes</th>
                      <th className="th-static text-right">Total</th><th className="th-static">Paiement</th>
                      <th className="th-static">Statut</th><th className="th-static w-24">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.items.length === 0 && (
                      <tr><td colSpan={8} className="td text-center py-10 text-slate-400">Aucune vente trouvée</td></tr>
                    )}
                    {data.items.map((v: any) => (
                      <tr key={v.id} className="tr-hover">
                        <td className="td font-mono text-xs font-bold text-brand-700">{v.numero}</td>
                        <td className="td">{fmtDateTime(v.date)}</td>
                        <td className="td">{v.user?.prenom} {v.user?.nom}</td>
                        <td className="td">{v.nbItems}</td>
                        <td className="td text-right font-bold">{fmtMoney(v.total)}</td>
                        <td className="td"><Badge statut={v.modePaiement} label={v.modePaiement.replace('_', ' ')} /></td>
                        <td className="td"><Badge statut={v.statut} label={v.statut === 'VALIDEE' ? 'Validée' : 'Annulée'} /></td>
                        <td className="td">
                          <div className="flex gap-1">
                            <button className="p-1.5 rounded-md hover:bg-brand-50 text-brand-600" title="Voir la facture"
                              onClick={() => navigate(`/ventes/${v.id}`)}><Eye className="w-4 h-4" /></button>
                            {v.statut === 'VALIDEE' && can('facturation', 'full') && (
                              <button className="p-1.5 rounded-md hover:bg-red-50 text-red-500" title="Annuler (admin)"
                                onClick={() => setAnnulTarget(v)}><Ban className="w-4 h-4" /></button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
            </div>
          )}
        </>
      )}

      {/* Détail facture */}
      {detail && (
        <div className="card p-5 sm:p-8 max-w-3xl mx-auto">
          {!vente ? <Loading label="Chargement de la facture…" /> : (
            <>
              <FacturePrint facture={vente} />
              <div className="flex justify-end gap-2 mt-6 no-print">
                {vente.statut === 'VALIDEE' && can('facturation', 'full') && (
                  <button className="btn-danger" onClick={() => setAnnulTarget(vente)}>
                    <Ban className="w-4 h-4" /> Annuler la vente
                  </button>
                )}
                <button className="btn-secondary" onClick={() => downloadExport(`/api/exports/facture/${vente.id}/pdf`, `${vente.numero}.pdf`).catch((e) => toast('error', e.message))}>
                  <ReceiptText className="w-4 h-4" /> PDF
                </button>
                <button className="btn-primary" onClick={() => window.print()}>
                  <Printer className="w-4 h-4" /> Imprimer
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* Annulation */}
      <Modal open={!!annulTarget} onClose={() => setAnnulTarget(null)} title={`Annuler la vente ${annulTarget?.numero || ''}`}>
        <p className="text-sm text-slate-600 mb-3">
          Le stock sera restauré automatiquement. Cette action est tracée dans le journal d'audit.
        </p>
        <label className="label">Motif de l'annulation *</label>
        <textarea className="input" rows={3} value={motif} onChange={(e) => setMotif(e.target.value)}
          placeholder="Ex : erreur de saisie, retour client…" />
        <div className="flex justify-end gap-2 mt-4">
          <button className="btn-secondary" onClick={() => setAnnulTarget(null)}>Retour</button>
          <button className="btn-danger" disabled={motif.trim().length < 3} onClick={annuler}>Confirmer l'annulation</button>
        </div>
      </Modal>
    </div>
  );
}
