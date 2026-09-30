import { useCallback, useEffect, useState } from 'react';
import { Plus, ClipboardList, Eye, CheckCircle2, Save, Search } from 'lucide-react';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { fmtMoney, fmtNum, fmtDate, fmtDateTime } from '../lib/format';
import { Loading, Badge, Modal, Field, ConfirmDialog } from '../components/ui';
import { ExportButtons } from '../components/ExportButtons';

export default function Inventaires() {
  const { can } = useAuth();
  const { toast } = useToast();
  const [list, setList] = useState<any[] | null>(null);
  const [open, setOpen] = useState<any>(null); // inventaire détaillé
  const [createOpen, setCreateOpen] = useState(false);
  const [observations, setObservations] = useState('');
  const [validTarget, setValidTarget] = useState<any>(null);
  const [q, setQ] = useState('');
  const canEdit = can('inventaire', 'full');

  const load = useCallback(() => {
    api.get('/api/inventaires').then(setList).catch((e) => toast('error', e.message));
  }, []);
  useEffect(() => { load(); }, [load]);

  const openInv = async (inv: any) => {
    const d = await api.get(`/api/inventaires/${inv.id}`);
    setOpen(d);
  };

  const creer = async () => {
    try {
      const inv = await api.post('/api/inventaires', { observations: observations || null });
      toast('success', `Inventaire ${inv.numero} créé — saisissez les quantités physiques`);
      setCreateOpen(false); setObservations('');
      load(); openInv(inv);
    } catch (e: any) { toast('error', e.message); }
  };

  const saveItem = async (itemId: number, stockPhysique: number, observation?: string) => {
    try {
      const updated = await api.put(`/api/inventaires/${open.id}/items/${itemId}`, { stockPhysique, observation });
      setOpen({
        ...open,
        items: open.items.map((i: any) => (i.id === itemId ? { ...i, ...updated } : i)),
      });
    } catch (e: any) { toast('error', e.message); }
  };

  const valider = async () => {
    try {
      const r = await api.post(`/api/inventaires/${validTarget.id}/valider`);
      toast('success', `Inventaire validé — surplus: ${r.resume.surplus}, déficits: ${r.resume.deficit}, valeur écart: ${fmtMoney(r.resume.valeurEcartTotale)}`);
      load(); setOpen(null);
    } catch (e: any) { toast('error', e.message); }
  };

  const itemsFiltres = open ? open.items.filter((i: any) =>
    !q || i.medicament.nom.toLowerCase().includes(q.toLowerCase()) || i.medicament.code.includes(q)
  ) : [];
  const ecarts = open?.items.filter((i: any) => i.ecart !== 0) || [];
  const valeurEcarts = open?.items.reduce((s: number, i: any) => s + (i.valeurEcart || 0), 0) || 0;

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-800">Inventaire</h1>
          <p className="text-sm text-slate-500">Inventaires physiques et historique des écarts</p>
        </div>
        {canEdit && (
          <button className="btn-primary" onClick={() => setCreateOpen(true)}>
            <Plus className="w-4 h-4" /> Nouvel inventaire
          </button>
        )}
      </div>

      {!list ? <Loading /> : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="th-static">N°</th><th className="th-static">Date</th>
                  <th className="th-static">Utilisateur</th><th className="th-static">Produits</th>
                  <th className="th-static">Statut</th><th className="th-static">Observations</th>
                  <th className="th-static w-28">Actions</th>
                </tr>
              </thead>
              <tbody>
                {list.length === 0 && <tr><td colSpan={7} className="td text-center py-10 text-slate-400">Aucun inventaire réalisé</td></tr>}
                {list.map((inv) => (
                  <tr key={inv.id} className="tr-hover">
                    <td className="td font-mono text-xs font-bold text-brand-700">{inv.numero}</td>
                    <td className="td">{fmtDateTime(inv.date)}</td>
                    <td className="td">{inv.user?.prenom} {inv.user?.nom}</td>
                    <td className="td">{inv.nbItems}</td>
                    <td className="td">
                      <Badge statut={inv.statut} label={inv.statut === 'VALIDE' ? '✅ Validé' : '🕓 En cours'} />
                    </td>
                    <td className="td max-w-[240px] truncate text-xs text-slate-500">{inv.observations || '—'}</td>
                    <td className="td">
                      <div className="flex gap-1">
                        <button className="p-1.5 rounded-md hover:bg-brand-50 text-brand-600" title="Ouvrir" onClick={() => openInv(inv)}>
                          <Eye className="w-4 h-4" />
                        </button>
                        <ExportButtons what="inventaire" params={{ id: inv.id }} compact />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Création */}
      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Nouvel inventaire physique">
        <div className="space-y-4">
          <p className="text-sm text-slate-500">
            Une photo du stock théorique de tous les médicaments actifs sera générée. Vous saisirez ensuite le stock physique compté.
          </p>
          <Field label="Observations générales">
            <textarea className="input" rows={3} value={observations} onChange={(e) => setObservations(e.target.value)}
              placeholder="Ex : inventaire mensuel de septembre…" />
          </Field>
          <div className="flex justify-end gap-2">
            <button className="btn-secondary" onClick={() => setCreateOpen(false)}>Annuler</button>
            <button className="btn-primary" onClick={creer}><ClipboardList className="w-4 h-4" /> Créer l'inventaire</button>
          </div>
        </div>
      </Modal>

      {/* Détail / saisie */}
      <Modal open={!!open} onClose={() => setOpen(null)} title={open ? `Inventaire ${open.numero} — ${open.statut === 'VALIDE' ? 'validé' : 'en cours'}` : ''} wide>
        {open && (
          <div className="space-y-3">
            <div className="flex flex-col md:flex-row md:items-center gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input className="input pl-9" placeholder="Filtrer les produits…" value={q} onChange={(e) => setQ(e.target.value)} />
              </div>
              <div className="text-xs text-slate-500 flex gap-4 items-center">
                <span>Écarts : <b className={ecarts.length ? 'text-amber-600' : ''}>{ecarts.length}</b></span>
                <span>Valeur écarts : <b className={valeurEcarts < 0 ? 'text-red-600' : 'text-emerald-600'}>{fmtMoney(valeurEcarts)}</b></span>
                {canEdit && open.statut === 'EN_COURS' && (
                  <button className="btn-primary btn-sm" onClick={() => setValidTarget(open)}>
                    <CheckCircle2 className="w-3.5 h-3.5" /> Valider l'inventaire
                  </button>
                )}
              </div>
            </div>
            <div className="overflow-auto max-h-[55vh] rounded-lg border border-slate-200">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10">
                  <tr>
                    <th className="th-static">Code</th><th className="th-static">Médicament</th>
                    <th className="th-static text-right">Stock théorique</th>
                    <th className="th-static text-center">Stock physique</th>
                    <th className="th-static text-right">Écart</th>
                    <th className="th-static text-right">Prix</th>
                    <th className="th-static text-right">Valeur écart</th>
                    <th className="th-static">Observation</th>
                  </tr>
                </thead>
                <tbody>
                  {itemsFiltres.map((i: any) => (
                    <tr key={i.id} className={`tr-hover ${i.ecart !== 0 ? 'bg-amber-50/60' : ''}`}>
                      <td className="td font-mono text-xs">{i.medicament.code}</td>
                      <td className="td font-medium max-w-[220px] truncate">{i.medicament.nom}</td>
                      <td className="td text-right">{i.stockTheorique}</td>
                      <td className="td">
                        {open.statut === 'EN_COURS' && canEdit ? (
                          <input type="number" min={0} defaultValue={i.stockPhysique} key={`${i.id}-${i.stockPhysique}`}
                            onBlur={(e) => { const v = parseInt(e.target.value) || 0; if (v !== i.stockPhysique) saveItem(i.id, v); }}
                            className="input w-20 py-1 text-center mx-auto block" />
                        ) : (
                          <p className="text-center font-semibold">{i.stockPhysique}</p>
                        )}
                      </td>
                      <td className={`td text-right font-bold ${i.ecart > 0 ? 'text-emerald-600' : i.ecart < 0 ? 'text-red-600' : 'text-slate-300'}`}>
                        {i.ecart > 0 ? `+${i.ecart}` : i.ecart}
                        {i.stockPhysique === 0 && i.stockTheorique > 0 && <span className="block text-[10px] text-red-500">manquant</span>}
                      </td>
                      <td className="td text-right text-xs">{fmtNum(i.prixUnitaire)}</td>
                      <td className={`td text-right text-xs font-semibold ${i.valeurEcart < 0 ? 'text-red-600' : i.valeurEcart > 0 ? 'text-emerald-600' : ''}`}>{fmtNum(i.valeurEcart)}</td>
                      <td className="td">
                        {open.statut === 'EN_COURS' && canEdit ? (
                          <input className="input py-1 text-xs w-40" defaultValue={i.observation || ''} placeholder="—"
                            onBlur={(e) => { if (e.target.value !== (i.observation || '')) saveItem(i.id, i.stockPhysique, e.target.value); }} />
                        ) : <span className="text-xs text-slate-500">{i.observation || '—'}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Modal>

      <ConfirmDialog open={!!validTarget} onClose={() => setValidTarget(null)} onConfirm={valider}
        title="Valider l'inventaire" confirmLabel="Valider et appliquer les écarts"
        message={<>Les écarts seront appliqués au stock réel (mouvements <b>AJUSTEMENT_INVENTAIRE</b> tracés). L'inventaire ne sera plus modifiable.</>} />
    </div>
  );
}
