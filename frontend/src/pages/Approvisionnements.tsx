import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Search, Plus, Trash2, Truck, Eye, Ban, ArrowLeft, PackagePlus, BookOpenCheck, Pill,
} from 'lucide-react';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { fmtMoney, fmtNum, fmtDate, fmtDateTime } from '../lib/format';
import { Loading, Badge, Modal, Pagination,  Field, ConfirmDialog } from '../components/ui';
import { ExportButtons } from '../components/ExportButtons';

interface Line {
  key: number;
  medicamentId?: number | null; // existant
  code: string; nom: string; emballage: string;
  quantite: number; prixAchat: number; prixVente: number;
  numLot: string; dateExpiration: string; stockMinimal: number;
  source: 'stock' | 'catalogue' | 'manuel';
}

let lineKey = 1;

export default function Approvisionnements() {
  const { can } = useAuth();
  const { toast } = useToast();
  const [view, setView] = useState<'list' | 'create'>('list');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<any>(null);
  const [detail, setDetail] = useState<any>(null);
  const [annulTarget, setAnnulTarget] = useState<any>(null);
  const canEdit = can('approvisionnement', 'full');

  const load = useCallback(() => {
    api.get(`/api/approvisionnements?page=${page}&pageSize=15`).then(setData).catch((e) => toast('error', e.message));
  }, [page]);
  useEffect(() => { load(); }, [load]);

  const annuler = async () => {
    try {
      await api.post(`/api/approvisionnements/${annulTarget.id}/annuler`);
      toast('success', 'Approvisionnement annulé — stock restauré');
      load();
    } catch (e: any) { toast('error', e.message); }
  };

  if (view === 'create' && canEdit) {
    return <CreateForm onDone={(ok) => { setView('list'); if (ok) load(); }} />;
  }

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-800">Approvisionnement</h1>
          <p className="text-sm text-slate-500">Bons de commande et entrées de stock</p>
        </div>
        <div className="flex gap-2 items-center flex-wrap">
          <ExportButtons what="approvisionnements" />
          {canEdit && (
            <button className="btn-primary" onClick={() => setView('create')}>
              <Plus className="w-4 h-4" /> Nouvel approvisionnement
            </button>
          )}
        </div>
      </div>

      {!data ? <Loading /> : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="th-static">N°</th><th className="th-static">Date</th>
                  <th className="th-static">Fournisseur</th><th className="th-static">Produits</th>
                  <th className="th-static text-right">Valeur achat</th>
                  <th className="th-static text-right">Valeur vente</th>
                  <th className="th-static text-right">Marge potentielle</th>
                  <th className="th-static">Statut</th><th className="th-static w-24">Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.items.length === 0 && <tr><td colSpan={9} className="td text-center py-10 text-slate-400">Aucun approvisionnement</td></tr>}
                {data.items.map((a: any) => (
                  <tr key={a.id} className="tr-hover">
                    <td className="td font-mono text-xs font-bold text-brand-700">{a.numero}</td>
                    <td className="td">{fmtDate(a.date)}</td>
                    <td className="td">{a.fournisseur?.nom || '—'}</td>
                    <td className="td">{a.nbItems}</td>
                    <td className="td text-right font-semibold">{fmtMoney(a.totalAchat)}</td>
                    <td className="td text-right">{fmtMoney(a.totalVente)}</td>
                    <td className="td text-right font-bold text-emerald-600">{fmtMoney(a.margePotentielle)}</td>
                    <td className="td"><Badge statut={a.statut} label={a.statut === 'VALIDE' ? 'Validé' : 'Annulé'} /></td>
                    <td className="td">
                      <div className="flex gap-1">
                        <button className="p-1.5 rounded-md hover:bg-brand-50 text-brand-600" title="Détail"
                          onClick={() => api.get(`/api/approvisionnements/${a.id}`).then(setDetail)}><Eye className="w-4 h-4" /></button>
                        {a.statut === 'VALIDE' && canEdit && (
                          <button className="p-1.5 rounded-md hover:bg-red-50 text-red-500" title="Annuler"
                            onClick={() => setAnnulTarget(a)}><Ban className="w-4 h-4" /></button>
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

      {/* Détail */}
      <Modal open={!!detail} onClose={() => setDetail(null)} title={`Approvisionnement ${detail?.numero || ''}`} wide>
        {detail && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              <div><p className="text-xs text-slate-400">Date</p><p className="font-semibold">{fmtDateTime(detail.date)}</p></div>
              <div><p className="text-xs text-slate-400">Fournisseur</p><p className="font-semibold">{detail.fournisseur?.nom || '—'}</p></div>
              <div><p className="text-xs text-slate-400">Utilisateur</p><p className="font-semibold">{detail.user?.prenom} {detail.user?.nom}</p></div>
              <div><p className="text-xs text-slate-400">Statut</p><Badge statut={detail.statut} label={detail.statut === 'VALIDE' ? 'Validé' : 'Annulé'} /></div>
            </div>
            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th className="th-static">Code</th><th className="th-static">Médicament</th>
                    <th className="th-static">Lot</th><th className="th-static">Expiration</th>
                    <th className="th-static text-right">Qté</th><th className="th-static text-right">P. achat</th>
                    <th className="th-static text-right">P. vente</th><th className="th-static text-right">Valeur achat</th>
                    <th className="th-static text-right">Valeur vente</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.items.map((it: any) => (
                    <tr key={it.id} className="tr-hover">
                      <td className="td font-mono text-xs">{it.medicament?.code}</td>
                      <td className="td font-medium max-w-[220px] truncate">{it.medicament?.nom}</td>
                      <td className="td text-xs">{it.numLot || '—'}</td>
                      <td className="td text-xs">{fmtDate(it.dateExpiration)}</td>
                      <td className="td text-right">{it.quantite}</td>
                      <td className="td text-right">{fmtNum(it.prixAchat)}</td>
                      <td className="td text-right">{fmtNum(it.prixVente)}</td>
                      <td className="td text-right font-semibold">{fmtNum(it.valeurAchat)}</td>
                      <td className="td text-right font-semibold text-emerald-600">{fmtNum(it.valeurVente)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex justify-end gap-6 text-sm font-bold">
              <span>Total achat : <span className="text-slate-800">{fmtMoney(detail.totalAchat)}</span></span>
              <span>Total vente : <span className="text-slate-800">{fmtMoney(detail.totalVente)}</span></span>
              <span>Marge : <span className="text-emerald-600">{fmtMoney(detail.margePotentielle)}</span></span>
            </div>
          </div>
        )}
      </Modal>

      <ConfirmDialog open={!!annulTarget} onClose={() => setAnnulTarget(null)} onConfirm={annuler}
        title="Annuler l'approvisionnement" danger confirmLabel="Annuler l'approvisionnement"
        message={<>L'approvisionnement <b>{annulTarget?.numero}</b> sera annulé et les quantités seront retirées du stock. Continuer ?</>} />
    </div>
  );
}

// ---------------- Formulaire de création ----------------

function CreateForm({ onDone }: { onDone: (ok: boolean) => void }) {
  const { toast } = useToast();
  const [fournisseurs, setFournisseurs] = useState<any[]>([]);
  const [fournisseurId, setFournisseurId] = useState<number | ''>('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [q, setQ] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.get('/api/fournisseurs').then((f) => { setFournisseurs(f); if (f.length) setFournisseurId(f[0].id); }).catch(() => {});
  }, []);

  // recherche mixte : médicaments en stock + catalogue PDF
  useEffect(() => {
    if (q.trim().length < 1) { setResults([]); return; }
    const t = setTimeout(async () => {
      try {
        const [meds, cat] = await Promise.all([
          api.get(`/api/medicaments/search?q=${encodeURIComponent(q.trim())}`),
          api.get(`/api/catalog/lookup?q=${encodeURIComponent(q.trim())}`),
        ]);
        const merged: any[] = [];
        const seen = new Set<string>();
        for (const m of meds.slice(0, 6)) {
          seen.add(m.code);
          merged.push({ type: 'stock', ...m });
        }
        for (const c of cat.slice(0, 8)) {
          if (seen.has(c.code)) continue;
          merged.push({ type: 'catalogue', ...c });
        }
        setResults(merged);
      } catch { setResults([]); }
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  const addLine = (r: any) => {
    if (r.type === 'stock') {
      if (lines.some((l) => l.medicamentId === r.id)) return toast('warning', 'Produit déjà dans la liste');
      setLines((ls) => [...ls, {
        key: lineKey++, medicamentId: r.id, code: r.code, nom: r.nom, emballage: r.emballage || '',
        quantite: 10, prixAchat: r.prixAchat, prixVente: r.prixVente,
        numLot: '', dateExpiration: '', stockMinimal: r.stockMinimal, source: 'stock',
      }]);
    } else {
      if (lines.some((l) => l.code === r.code)) return toast('warning', 'Produit déjà dans la liste');
      setLines((ls) => [...ls, {
        key: lineKey++, medicamentId: null, code: r.code, nom: r.designation, emballage: r.emballage || '',
        quantite: 10, prixAchat: Math.round(r.prix * 0.78 * 100) / 100, prixVente: r.prix,
        numLot: '', dateExpiration: '', stockMinimal: 10, source: 'catalogue',
      }]);
      toast('info', `Prix du catalogue PDF récupéré automatiquement (${fmtMoney(r.prix)})`);
    }
    setQ(''); setResults([]);
    searchRef.current?.focus();
  };

  const addManuel = () => setLines((ls) => [...ls, {
    key: lineKey++, medicamentId: null, code: '', nom: '', emballage: '',
    quantite: 1, prixAchat: 0, prixVente: 0, numLot: '', dateExpiration: '', stockMinimal: 10, source: 'manuel',
  }]);

  const upd = (key: number, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const del = (key: number) => setLines((ls) => ls.filter((l) => l.key !== key));

  const totalAchat = lines.reduce((s, l) => s + l.quantite * l.prixAchat, 0);
  const totalVente = lines.reduce((s, l) => s + l.quantite * l.prixVente, 0);

  const submit = async () => {
    if (!lines.length) return toast('error', 'Ajoutez au moins un produit');
    for (const l of lines) {
      if (!l.code || !l.nom) return toast('error', 'Code et nom requis sur chaque ligne');
      if (l.quantite <= 0) return toast('error', `Quantité invalide pour ${l.nom}`);
    }
    setBusy(true);
    try {
      const res = await api.post('/api/approvisionnements', {
        fournisseurId: fournisseurId || null, date, notes: notes || null,
        items: lines.map((l) => ({
          medicamentId: l.medicamentId ?? undefined,
          code: l.code, nom: l.nom, emballage: l.emballage || undefined,
          quantite: l.quantite, prixAchat: l.prixAchat, prixVente: l.prixVente,
          numLot: l.numLot || undefined, dateExpiration: l.dateExpiration || undefined,
          stockMinimal: l.stockMinimal,
        })),
      });
      toast('success', `Approvisionnement ${res.numero} enregistré — stock augmenté automatiquement`);
      onDone(true);
    } catch (e: any) {
      toast('error', e.message || 'Échec de l\'enregistrement');
    } finally { setBusy(false); }
  };

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center gap-3 flex-wrap">
        <button className="btn-secondary btn-sm" onClick={() => onDone(false)}><ArrowLeft className="w-4 h-4" /> Retour</button>
        <div>
          <h1 className="text-2xl font-extrabold text-slate-800">Nouvel approvisionnement</h1>
          <p className="text-sm text-slate-500">Le stock est augmenté automatiquement à la validation.</p>
        </div>
      </div>

      <div className="card p-4 grid grid-cols-1 md:grid-cols-4 gap-3">
        <Field label="Fournisseur">
          <select className="input" value={fournisseurId} onChange={(e) => setFournisseurId(e.target.value ? Number(e.target.value) : '')}>
            <option value="">— Aucun —</option>
            {fournisseurs.filter((f) => f.actif).map((f) => <option key={f.id} value={f.id}>{f.nom}</option>)}
          </select>
        </Field>
        <Field label="Date d'approvisionnement">
          <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Notes" className="md:col-span-2">
          <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Référence bon de commande, remarques…" />
        </Field>
      </div>

      {/* Recherche */}
      <div className="card p-4">
        <div className="relative">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
          <input ref={searchRef} className="input pl-11 py-3"
            placeholder="Rechercher dans le stock ou le catalogue des prix PDF (code, nom, emballage)…"
            value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {q && (
          <div className="mt-2 max-h-72 overflow-y-auto rounded-lg border border-slate-100 divide-y divide-slate-50">
            {results.length === 0 && <p className="text-sm text-slate-400 text-center py-6">Aucun résultat — cliquez sur « Ligne libre » pour un produit absent du catalogue.</p>}
            {results.map((r) => (
              <button key={`${r.type}-${r.id || r.code}`} onClick={() => addLine(r)}
                className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-brand-50/60 text-left">
                {r.type === 'stock'
                  ? <Pill className="w-4 h-4 text-brand-600 shrink-0" />
                  : <BookOpenCheck className="w-4 h-4 text-violet-500 shrink-0" />}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-slate-700 truncate">{r.nom || r.designation}</p>
                  <p className="text-xs text-slate-400 font-mono">{r.code} · {r.emballage || '—'}</p>
                </div>
                <Badge statut={r.type === 'stock' ? 'NORMAL' : 'CARTE'} label={r.type === 'stock' ? `En stock : ${r.stock}` : 'Catalogue PDF'} />
                <span className="font-bold text-sm text-brand-700 shrink-0">{fmtMoney(r.prixVente ?? r.prix)}</span>
              </button>
            ))}
          </div>
        )}
        <div className="flex justify-between items-center mt-3">
          <button className="btn-secondary btn-sm" onClick={addManuel}><Plus className="w-3.5 h-3.5" /> Ligne libre (nouveau produit)</button>
          <p className="text-xs text-slate-400">{lines.length} ligne(s)</p>
        </div>
      </div>

      {/* Lignes */}
      {lines.length > 0 && (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="th-static">Code</th><th className="th-static min-w-[200px]">Nom / désignation</th>
                  <th className="th-static">Emb.</th><th className="th-static">Qté *</th>
                  <th className="th-static">Prix achat *</th><th className="th-static">Prix vente *</th>
                  <th className="th-static">N° lot</th><th className="th-static">Expiration</th>
                  <th className="th-static">Stock min.</th>
                  <th className="th-static text-right">Valeur achat</th><th className="th-static text-right">Valeur vente</th>
                  <th className="th-static text-right">Marge</th><th className="th-static w-10" />
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.key} className="tr-hover align-top">
                    <td className="td"><input className="input w-20 py-1 font-mono text-xs" value={l.code} onChange={(e) => upd(l.key, { code: e.target.value })} disabled={!!l.medicamentId} /></td>
                    <td className="td"><input className="input py-1 text-xs" value={l.nom} onChange={(e) => upd(l.key, { nom: e.target.value })} /></td>
                    <td className="td"><input className="input w-16 py-1 text-xs" value={l.emballage} onChange={(e) => upd(l.key, { emballage: e.target.value })} /></td>
                    <td className="td"><input type="number" min={1} className="input w-20 py-1 text-xs" value={l.quantite} onChange={(e) => upd(l.key, { quantite: parseInt(e.target.value) || 0 })} /></td>
                    <td className="td"><input type="number" min={0} step="0.01" className="input w-24 py-1 text-xs" value={l.prixAchat} onChange={(e) => upd(l.key, { prixAchat: parseFloat(e.target.value) || 0 })} /></td>
                    <td className="td"><input type="number" min={0} step="0.01" className="input w-24 py-1 text-xs" value={l.prixVente} onChange={(e) => upd(l.key, { prixVente: parseFloat(e.target.value) || 0 })} /></td>
                    <td className="td"><input className="input w-24 py-1 text-xs" value={l.numLot} onChange={(e) => upd(l.key, { numLot: e.target.value })} placeholder="LOT-…" /></td>
                    <td className="td"><input type="date" className="input w-32 py-1 text-xs" value={l.dateExpiration} onChange={(e) => upd(l.key, { dateExpiration: e.target.value })} /></td>
                    <td className="td"><input type="number" min={0} className="input w-16 py-1 text-xs" value={l.stockMinimal} onChange={(e) => upd(l.key, { stockMinimal: parseInt(e.target.value) || 0 })} /></td>
                    <td className="td text-right font-semibold">{fmtNum(l.quantite * l.prixAchat)}</td>
                    <td className="td text-right font-semibold">{fmtNum(l.quantite * l.prixVente)}</td>
                    <td className="td text-right font-bold text-emerald-600">{fmtNum(l.quantite * (l.prixVente - l.prixAchat))}</td>
                    <td className="td"><button className="p-1.5 rounded-md text-red-400 hover:bg-red-50" onClick={() => del(l.key)}><Trash2 className="w-4 h-4" /></button></td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-slate-50 font-bold">
                  <td colSpan={9} className="td text-right">TOTAUX</td>
                  <td className="td text-right">{fmtNum(totalAchat)}</td>
                  <td className="td text-right">{fmtNum(totalVente)}</td>
                  <td className="td text-right text-emerald-600">{fmtNum(totalVente - totalAchat)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
          <div className="p-4 flex flex-col sm:flex-row items-center justify-between gap-3 border-t border-slate-100 bg-brand-50/40">
            <p className="text-sm text-slate-600">
              Marge potentielle totale : <b className="text-emerald-600">{fmtMoney(totalVente - totalAchat)}</b>
            </p>
            <button className="btn-primary py-3 px-8" disabled={busy} onClick={submit}>
              <Truck className="w-4 h-4" /> {busy ? 'Enregistrement…' : `Valider l'approvisionnement — ${fmtMoney(totalAchat)}`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
