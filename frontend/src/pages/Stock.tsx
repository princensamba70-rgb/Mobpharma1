import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Search, Boxes, AlertTriangle, CircleSlash, CalendarClock, History, SlidersHorizontal, CalendarX2 } from 'lucide-react';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { fmtMoney, fmtNum, fmtDate } from '../lib/format';
import { Loading, Badge, Modal, Tabs, Field,  Pagination } from '../components/ui';
import { ExportButtons } from '../components/ExportButtons';
import { StatCard } from '../components/StatCard';

export default function Stock() {
  const { can } = useAuth();
  const { toast } = useToast();
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState(params.get('tab') === 'expiration' ? 'expiration' : 'stock');
  const [statut, setStatut] = useState(params.get('statut') || 'TOUS');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<any>(null);
  const [expData, setExpData] = useState<any>(null);
  const [adjust, setAdjust] = useState<any>(null);
  const [histo, setHisto] = useState<any>(null);
  const pageSize = 25;

  const load = useCallback(() => {
    const qs = new URLSearchParams({ page: String(page), pageSize: String(pageSize), statut });
    if (q) qs.set('q', q);
    api.get(`/api/stock?${qs}`).then(setData).catch((e) => toast('error', e.message));
  }, [page, statut, q]);

  useEffect(() => { if (tab === 'stock') { const t = setTimeout(load, q ? 250 : 0); return () => clearTimeout(t); } }, [load, tab, q]);
  useEffect(() => { if (tab === 'expiration') api.get('/api/stock/expiration').then(setExpData).catch((e) => toast('error', e.message)); }, [tab]);

  const openHisto = async (med: any) => {
    const d = await api.get(`/api/stock/mouvements?medicamentId=${med.id}&pageSize=50`);
    setHisto({ med, mouvements: d.items });
  };

  const r = data?.resume;

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-800">Gestion de stock</h1>
          <p className="text-sm text-slate-500">Quantités exactes en temps réel</p>
        </div>
        <div className="flex gap-2 items-center">
          <ExportButtons what="stock" params={{ statut: statut !== 'TOUS' ? statut : undefined }} />
        </div>
      </div>

      {r && (
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
          <StatCard icon={<Boxes className="w-5 h-5" />} label="Produits actifs" value={fmtNum(data.total)} accent="teal" />
          <StatCard icon={<Boxes className="w-5 h-5" />} label="Stock normal" value={fmtNum(r.normal)} accent="green" />
          <StatCard icon={<AlertTriangle className="w-5 h-5" />} label="Stock faible" value={fmtNum(r.faible)} accent="amber" onClick={() => { setStatut('FAIBLE'); setTab('stock'); }} />
          <StatCard icon={<CircleSlash className="w-5 h-5" />} label="Épuisés" value={fmtNum(r.epuise)} accent="red" onClick={() => { setStatut('EPUISE'); setTab('stock'); }} />
          <StatCard icon={<CalendarClock className="w-5 h-5" />} label="Expiration proche" value={fmtNum(r.expirationProche)} accent="orange" onClick={() => setTab('expiration')} />
          <StatCard icon={<CalendarX2 className="w-5 h-5" />} label="Expirés" value={fmtNum(r.expire)} accent="red" />
        </div>
      )}

      <Tabs tabs={[
        { id: 'stock', label: '📦 Stock' },
        { id: 'expiration', label: '⏳ Expiration' },
      ]} active={tab} onChange={(t) => { setTab(t); setParams({}); }} />

      {tab === 'stock' && (
        <>
          <div className="card p-4 flex flex-col md:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input className="input pl-9" placeholder="Rechercher (code, nom, désignation, emballage)…"
                value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
            </div>
            <select className="input md:w-56" value={statut} onChange={(e) => { setStatut(e.target.value); setPage(1); }}>
              <option value="TOUS">Tous les statuts</option>
              <option value="NORMAL">🟢 Stock normal</option>
              <option value="FAIBLE">🟠 Stock faible</option>
              <option value="EPUISE">🔴 Stock épuisé</option>
              <option value="EXPIRATION_PROCHE">⚠️ Expiration proche</option>
              <option value="EXPIRE">🔴 Produit expiré</option>
            </select>
          </div>

          {statut === 'FAIBLE' && data && data.resume?.faible > 0 && (
            <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-sm font-bold text-amber-700 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" /> STOCK FAIBLE — APPROVISIONNEMENT NÉCESSAIRE ({data.resume.faible} produit(s))
            </div>
          )}
          {statut === 'EPUISE' && data && data.resume?.epuise > 0 && (
            <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm font-bold text-red-700 flex items-center gap-2">
              <CircleSlash className="w-4 h-4" /> STOCK ÉPUISÉ ({data.resume.epuise} produit(s))
            </div>
          )}

          {!data ? <Loading /> : (
            <div className="card overflow-hidden">
              {r && (
                <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-100 text-xs text-slate-500 flex gap-4 flex-wrap">
                  <span>Valeur stock (achat) : <b className="text-slate-700">{fmtMoney(r.valeurStockAchat)}</b></span>
                  <span>Valeur stock (vente) : <b className="text-slate-700">{fmtMoney(r.valeurStockVente)}</b></span>
                </div>
              )}
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr>
                      <th className="th-static">Code</th><th className="th-static">Médicament</th>
                      <th className="th-static">Emb.</th><th className="th-static text-right">Stock</th>
                      <th className="th-static text-right">Stock min.</th><th className="th-static text-right">Prix vente</th>
                      <th className="th-static">Expiration</th><th className="th-static">Statut</th>
                      <th className="th-static w-20">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.items.length === 0 && <tr><td colSpan={9} className="td text-center py-10 text-slate-400">Aucun produit</td></tr>}
                    {data.items.map((m: any) => (
                      <tr key={m.id} className="tr-hover">
                        <td className="td font-mono text-xs">{m.code}</td>
                        <td className="td font-medium max-w-[260px] truncate" title={m.nom}>{m.nom}</td>
                        <td className="td text-xs">{m.emballage || '—'}</td>
                        <td className={`td text-right font-bold ${m.stock <= 0 ? 'text-red-600' : m.stock <= m.stockMinimal ? 'text-amber-600' : 'text-slate-800'}`}>{m.stock}</td>
                        <td className="td text-right text-slate-400">{m.stockMinimal}</td>
                        <td className="td text-right">{m.prixVente > 0 ? fmtMoney(m.prixVente) : <span className="text-slate-400 italic text-xs">Prix non défini</span>}</td>
                        <td className="td text-xs">
                          {m.expirationProchaine ? (
                            <span className={m.joursRestants < 0 ? 'text-red-600 font-bold' : m.joursRestants <= 90 ? 'text-orange-600 font-semibold' : ''}>
                              {fmtDate(m.expirationProchaine)} <span className="text-slate-400">({m.joursRestants} j)</span>
                            </span>
                          ) : '—'}
                        </td>
                        <td className="td"><Badge statut={m.statut} label={m.statutLibelle} /></td>
                        <td className="td">
                          <div className="flex gap-1">
                            <button className="p-1.5 rounded-md hover:bg-brand-50 text-brand-600" title="Historique des mouvements" onClick={() => openHisto(m)}>
                              <History className="w-4 h-4" />
                            </button>
                            {can('stock', 'full') && (
                              <button className="p-1.5 rounded-md hover:bg-amber-50 text-amber-600" title="Ajuster le stock" onClick={() => setAdjust(m)}>
                                <SlidersHorizontal className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex items-center justify-between">
                <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
              </div>
            </div>
          )}
        </>
      )}

      {tab === 'expiration' && (
        !expData ? <Loading /> : (
          <div className="space-y-4">
            <div className="rounded-xl bg-orange-50 border border-orange-200 px-4 py-3 text-sm text-orange-800">
              <b>Seuils d'alerte configurés :</b> {expData.seuils.map((s: number) => `${s} j`).join(' · ')} — modifiables dans Paramètres (admin).
            </div>
            <div className="card overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-100 font-bold text-slate-700">
                ⏳ Produits proches de l'expiration ({expData.items.length})
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr>
                      <th className="th-static">Code</th><th className="th-static">Médicament</th>
                      <th className="th-static">Date expiration</th><th className="th-static text-right">Jours restants</th>
                      <th className="th-static text-right">Quantité</th><th className="th-static text-right">Valeur du stock</th>
                      <th className="th-static">Niveau d'alerte</th>
                    </tr>
                  </thead>
                  <tbody>
                    {expData.items.length === 0 && <tr><td colSpan={7} className="td text-center py-10 text-slate-400">Aucun produit concerné 🎉</td></tr>}
                    {expData.items.map((e: any) => (
                      <tr key={e.id} className="tr-hover">
                        <td className="td font-mono text-xs">{e.code}</td>
                        <td className="td font-medium max-w-[280px] truncate">{e.medicament}</td>
                        <td className="td">{fmtDate(e.dateExpiration)}</td>
                        <td className={`td text-right font-bold ${e.joursRestants < 0 ? 'text-red-600' : e.joursRestants <= 30 ? 'text-red-500' : e.joursRestants <= 90 ? 'text-orange-500' : 'text-amber-500'}`}>
                          {e.joursRestants < 0 ? `Expiré depuis ${-e.joursRestants} j` : `${e.joursRestants} j`}
                        </td>
                        <td className="td text-right">{e.quantite}</td>
                        <td className="td text-right">{fmtMoney(e.valeurStock)}</td>
                        <td className="td">
                          <span className={`badge ${e.niveau === 'EXPIRE' ? 'bg-red-200 text-red-800' : e.niveau === 'J-30' ? 'bg-red-100 text-red-700' : e.niveau === 'J-60' ? 'bg-orange-100 text-orange-700' : 'bg-amber-100 text-amber-700'}`}>
                            {e.niveau === 'EXPIRE' ? '🔴 Expiré' : `⚠️ ${e.niveau.replace('J-', '≤ ')} jours`}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )
      )}

      {/* Ajustement de stock */}
      <AdjustModal med={adjust} onClose={() => setAdjust(null)} onDone={() => { setAdjust(null); load(); }} />

      {/* Historique mouvements */}
      <Modal open={!!histo} onClose={() => setHisto(null)} title={`Mouvements — ${histo?.med?.nom || ''}`} wide>
        {histo && (
          <div className="overflow-x-auto max-h-[60vh] overflow-y-auto rounded-lg border border-slate-200">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="th-static">Date</th><th className="th-static">Type</th>
                  <th className="th-static text-right">Qté</th><th className="th-static text-right">Avant</th>
                  <th className="th-static text-right">Après</th><th className="th-static">Référence</th>
                  <th className="th-static">Motif</th>
                </tr>
              </thead>
              <tbody>
                {histo.mouvements.map((mv: any) => (
                  <tr key={mv.id} className="tr-hover">
                    <td className="td text-xs">{fmtDate(mv.createdAt)}</td>
                    <td className="td text-xs"><Badge statut={mv.quantite >= 0 ? 'VALIDE' : 'ANNULEE'} label={mv.type.replace(/_/g, ' ')} /></td>
                    <td className={`td text-right font-bold ${mv.quantite >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{mv.quantite >= 0 ? '+' : ''}{mv.quantite}</td>
                    <td className="td text-right text-slate-400">{mv.stockAvant}</td>
                    <td className="td text-right">{mv.stockApres}</td>
                    <td className="td font-mono text-xs">{mv.reference || '—'}</td>
                    <td className="td text-xs max-w-[200px] truncate" title={mv.motif}>{mv.motif || '—'}</td>
                  </tr>
                ))}
                {histo.mouvements.length === 0 && <tr><td colSpan={7} className="td text-center py-8 text-slate-400">Aucun mouvement</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </Modal>
    </div>
  );
}

function AdjustModal({ med, onClose, onDone }: { med: any; onClose: () => void; onDone: () => void }) {
  const { toast } = useToast();
  const [stock, setStock] = useState(med?.stock ?? 0);
  const [motif, setMotif] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (med) { setStock(med.stock); setMotif(''); } }, [med]);

  const submit = async () => {
    setBusy(true);
    try {
      await api.post('/api/stock/ajustement', { medicamentId: med.id, nouveauStock: stock, motif });
      toast('success', 'Stock ajusté et mouvement enregistré');
      onDone();
    } catch (e: any) { toast('error', e.message); } finally { setBusy(false); }
  };

  return (
    <Modal open={!!med} onClose={onClose} title={`Ajuster le stock — ${med?.nom || ''}`}>
      {med && (
        <div className="space-y-4">
          <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 text-sm flex justify-between">
            <span className="text-slate-500">Stock actuel</span>
            <b className={stock !== med.stock ? (stock > med.stock ? 'text-emerald-600' : 'text-red-600') : ''}>
              {med.stock} {stock !== med.stock && `→ ${stock} (${stock > med.stock ? '+' : ''}${stock - med.stock})`}
            </b>
          </div>
          <Field label="Nouveau stock (compté physiquement)" required>
            <input type="number" min={0} className="input" value={stock} onChange={(e) => setStock(parseInt(e.target.value) || 0)} />
          </Field>
          <Field label="Motif de l'ajustement (obligatoire — tracé dans l'audit)" required>
            <textarea className="input" rows={3} value={motif} onChange={(e) => setMotif(e.target.value)}
              placeholder="Ex : casse, perte, erreur de saisie, comptage physique…" />
          </Field>
          <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            ⚠️ Le stock ne peut jamais être modifié sans motif enregistré (règle de traçabilité).
          </p>
          <div className="flex justify-end gap-2">
            <button className="btn-secondary" onClick={onClose}>Annuler</button>
            <button className="btn-primary" disabled={busy || motif.trim().length < 5} onClick={submit}>Enregistrer l'ajustement</button>
          </div>
        </div>
      )}
    </Modal>
  );
}
