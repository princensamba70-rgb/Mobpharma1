import { useCallback, useEffect, useState } from 'react';
import { Search, Plus, Pencil, Archive, Trash2, Pill, BookOpenCheck } from 'lucide-react';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { fmtMoney, fmtDate } from '../lib/format';
import { Loading, Badge, Modal, Field, Pagination, ConfirmDialog } from '../components/ui';
import { ExportButtons } from '../components/ExportButtons';
import { getLocalMedicationsPage, searchLocalCatalogue, saveMedicaments } from '../lib/offlineDb';

const emptyForm = {
  code: '', nom: '', designation: '', emballage: '', prixAchat: 0, prixVente: 0,
  stockMinimal: 10, quantite: 0, dateExpiration: '', numLot: '', fournisseurId: '' as any, categorieId: '' as any,
};

export default function Medicaments() {
  const { can } = useAuth();
  const { toast } = useToast();
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<any>(null);
  const [fournisseurs, setFournisseurs] = useState<any[]>([]);
  const [catOpen, setCatOpen] = useState<any>(null); // recherche catalogue pour pré-remplir
  const [catResults, setCatResults] = useState<any[]>([]);
  const [form, setForm] = useState<any>(emptyForm);
  const [editId, setEditId] = useState<number | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [delTarget, setDelTarget] = useState<any>(null);
  const canEdit = can('medicaments', 'full');
  const pageSize = 20;

  const load = useCallback(async () => {
    const local = await getLocalMedicationsPage(q, page, pageSize).catch(() => null);
    if (local && (typeof navigator === 'undefined' || navigator.onLine === false || local.items.length > 0)) setData(local);
    const qs = new URLSearchParams({ page: String(page), pageSize: String(pageSize), sortBy: 'nom' });
    if (q) qs.set('q', q);
    try {
      const remote = await api.get(`/api/medicaments?${qs}`);
      await saveMedicaments(remote.items || []).catch(() => {});
      setData(remote);
    } catch (error: any) {
      if (!local) toast('error', error.message);
    }
  }, [page, q]);

  useEffect(() => { const t = setTimeout(load, q ? 250 : 0); return () => clearTimeout(t); }, [load, q]);
  useEffect(() => { api.get('/api/fournisseurs').then(setFournisseurs).catch(() => {}); }, []);

  const openCreate = () => { setForm(emptyForm); setEditId(null); setModalOpen(true); };
  const openEdit = (m: any) => {
    setEditId(m.id);
    setForm({
      code: m.code, nom: m.nom, designation: m.designation || '', emballage: m.emballage || '',
      prixAchat: m.prixAchat, prixVente: m.prixVente, stockMinimal: m.stockMinimal,
      quantite: 0, dateExpiration: '', numLot: '',
      fournisseurId: m.fournisseur?.id || '', categorieId: m.categorie?.id || '',
    });
    setModalOpen(true);
  };

  // recherche catalogue PDF pour pré-remplir
  const searchCatalog = async (term: string) => {
    setForm((f: any) => ({ ...f, code: term }));
    if (term.length < 2) { setCatResults([]); return; }
    const localCatalog = await searchLocalCatalogue(term).catch(() => []);
    if (localCatalog.length) setCatResults(localCatalog.slice(0, 6));
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    try {
      const r = await api.get(`/api/catalog/lookup?q=${encodeURIComponent(term)}`);
      setCatResults(r.slice(0, 6));
    } catch { /* local catalogue remains usable */ }
  };
  const applyCatalog = (c: any) => {
    setForm((f: any) => ({ ...f, code: c.code, nom: c.designation, designation: c.designation, emballage: c.emballage || '', prixVente: c.prix }));
    setCatResults([]);
    toast('info', `Produit récupéré du catalogue PDF — prix ${fmtMoney(c.prix)}${c.prix === 0 ? ' (Prix = 0 CDF)' : ''}`);
  };

  const submit = async () => {
    if (!form.code || !form.nom) return toast('error', 'Code et nom obligatoires');
    const payload: any = {
      code: form.code, nom: form.nom, designation: form.designation || form.nom,
      emballage: form.emballage || null,
      prixAchat: Number(form.prixAchat) || 0, prixVente: Number(form.prixVente) || 0,
      stockMinimal: Number(form.stockMinimal) || 0,
      fournisseurId: form.fournisseurId ? Number(form.fournisseurId) : null,
      categorieId: form.categorieId ? Number(form.categorieId) : null,
    };
    try {
      if (editId) {
        await api.put(`/api/medicaments/${editId}`, payload);
        toast('success', 'Médicament modifié');
      } else {
        await api.post('/api/medicaments', { ...payload, quantite: Number(form.quantite) || 0, dateExpiration: form.dateExpiration || null, numLot: form.numLot || null });
        toast('success', 'Médicament ajouté');
      }
      setModalOpen(false); load();
    } catch (e: any) { toast('error', e.message); }
  };

  const archiver = async (m: any) => {
    try { await api.post(`/api/medicaments/${m.id}/archive`); toast('success', 'Médicament archivé (historique conservé)'); load(); }
    catch (e: any) { toast('error', e.message); }
  };
  const supprimer = async () => {
    try { await api.del(`/api/medicaments/${delTarget.id}`); toast('success', 'Médicament supprimé'); load(); }
    catch (e: any) { toast('error', e.message); }
  };

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-800">Médicaments</h1>
          <p className="text-sm text-slate-500">Catalogue produits de la pharmacie ({data?.total ?? '…'} références actives)</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <ExportButtons what="stock" />
          {canEdit && <button className="btn-primary" onClick={openCreate}><Plus className="w-4 h-4" /> Ajouter un médicament</button>}
        </div>
      </div>

      <div className="card p-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input className="input pl-9" placeholder="Recherche instantanée : code, nom, désignation, emballage…"
            value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
        </div>
      </div>

      {!data ? <Loading /> : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="th-static">Code</th><th className="th-static">Nom / désignation</th>
                  <th className="th-static">Emb.</th><th className="th-static text-right">Prix achat</th>
                  <th className="th-static text-right">Prix vente</th><th className="th-static text-right">Stock</th>
                  <th className="th-static text-right">Min.</th><th className="th-static">Fournisseur</th>
                  <th className="th-static">Statut</th>{canEdit && <th className="th-static w-28">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {data.items.length === 0 && <tr><td colSpan={10} className="td text-center py-10 text-slate-400">Aucun médicament</td></tr>}
                {data.items.map((m: any) => (
                  <tr key={m.id} className="tr-hover">
                    <td className="td font-mono text-xs">{m.code}</td>
                    <td className="td font-medium max-w-[260px] truncate" title={m.nom}>{m.nom}</td>
                    <td className="td text-xs">{m.emballage || '—'}</td>
                    <td className="td text-right text-xs">{fmtMoney(m.prixAchat)}</td>
                    <td className="td text-right font-semibold">{m.prixVente > 0 ? fmtMoney(m.prixVente) : <span className="text-slate-400 italic text-xs">Prix non défini</span>}</td>
                    <td className="td text-right font-bold">{m.stock}</td>
                    <td className="td text-right text-slate-400">{m.stockMinimal}</td>
                    <td className="td text-xs">{m.fournisseur?.nom || '—'}</td>
                    <td className="td"><Badge statut={m.statut} label={m.statutLibelle} /></td>
                    {canEdit && (
                      <td className="td">
                        <div className="flex gap-1">
                          <button className="p-1.5 rounded-md hover:bg-brand-50 text-brand-600" title="Modifier" onClick={() => openEdit(m)}><Pencil className="w-4 h-4" /></button>
                          <button className="p-1.5 rounded-md hover:bg-amber-50 text-amber-600" title="Archiver" onClick={() => archiver(m)}><Archive className="w-4 h-4" /></button>
                          <button className="p-1.5 rounded-md hover:bg-red-50 text-red-500" title="Supprimer (si sans historique)" onClick={() => setDelTarget(m)}><Trash2 className="w-4 h-4" /></button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
        </div>
      )}

      {/* Formulaire */}
      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editId ? 'Modifier le médicament' : 'Ajouter un médicament'} wide>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Code médicament" required className="relative">
            <input className="input font-mono" value={form.code}
              onChange={(e) => (editId ? setForm({ ...form, code: e.target.value }) : searchCatalog(e.target.value))}
              placeholder="ex : 1005" disabled={!!editId} />
            {catResults.length > 0 && !editId && (
              <div className="absolute z-20 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-lg overflow-hidden">
                <p className="px-3 py-1.5 text-[10px] font-bold uppercase text-slate-400 bg-slate-50 flex items-center gap-1">
                  <BookOpenCheck className="w-3 h-3" /> Catalogue des prix PDF
                </p>
                {catResults.map((c) => (
                  <button key={c.id} className="w-full text-left px-3 py-2 hover:bg-brand-50 text-sm flex justify-between gap-2" onClick={() => applyCatalog(c)}>
                    <span className="truncate"><span className="font-mono text-xs text-slate-400">{c.code}</span> {c.designation}</span>
                    <span className="font-bold text-brand-700 shrink-0">{fmtMoney(c.prix)}</span>
                  </button>
                ))}
              </div>
            )}
          </Field>
          <Field label="Nom / désignation" required>
            <input className="input" value={form.nom} onChange={(e) => setForm({ ...form, nom: e.target.value })} />
          </Field>
          <Field label="Emballage">
            <input className="input" value={form.emballage} onChange={(e) => setForm({ ...form, emballage: e.target.value })} placeholder="BTE, PLQ, FLC, AMP…" />
          </Field>
          <Field label="Fournisseur">
            <select className="input" value={form.fournisseurId} onChange={(e) => setForm({ ...form, fournisseurId: e.target.value })}>
              <option value="">— Aucun —</option>
              {fournisseurs.map((f) => <option key={f.id} value={f.id}>{f.nom}</option>)}
            </select>
          </Field>
          <Field label="Prix d'achat (CDF)">
            <input type="number" min={0} step="0.01" className="input" value={form.prixAchat} onChange={(e) => setForm({ ...form, prixAchat: e.target.value })} />
          </Field>
          <Field label="Prix de vente (CDF)">
            <input type="number" min={0} step="0.01" className="input" value={form.prixVente} onChange={(e) => setForm({ ...form, prixVente: e.target.value })} />
          </Field>
          <Field label="Stock minimal d'alerte">
            <input type="number" min={0} className="input" value={form.stockMinimal} onChange={(e) => setForm({ ...form, stockMinimal: e.target.value })} />
          </Field>
          {!editId && (
            <>
              <Field label="Quantité initiale">
                <input type="number" min={0} className="input" value={form.quantite} onChange={(e) => setForm({ ...form, quantite: e.target.value })} />
              </Field>
              <Field label="Date d'expiration (lot initial)">
                <input type="date" className="input" value={form.dateExpiration} onChange={(e) => setForm({ ...form, dateExpiration: e.target.value })} />
              </Field>
              <Field label="Numéro de lot">
                <input className="input" value={form.numLot} onChange={(e) => setForm({ ...form, numLot: e.target.value })} />
              </Field>
            </>
          )}
        </div>
        {form.prixVente > 0 && form.prixAchat > 0 && (
          <p className="text-xs text-emerald-600 mt-3 font-semibold">
            Marge unitaire potentielle : {fmtMoney(form.prixVente - form.prixAchat)} ({(((form.prixVente - form.prixAchat) / form.prixAchat) * 100).toFixed(1)} %)
          </p>
        )}
        {editId && (
          <p className="text-xs text-slate-400 mt-3">💡 Le stock se modifie uniquement via approvisionnement, vente ou inventaire (traçabilité).</p>
        )}
        <div className="flex justify-end gap-2 mt-5">
          <button className="btn-secondary" onClick={() => setModalOpen(false)}>Annuler</button>
          <button className="btn-primary" onClick={submit}>{editId ? 'Enregistrer les modifications' : 'Ajouter le médicament'}</button>
        </div>
      </Modal>

      <ConfirmDialog open={!!delTarget} onClose={() => setDelTarget(null)} onConfirm={supprimer} danger
        title="Supprimer le médicament" confirmLabel="Supprimer"
        message={<>Supprimer <b>{delTarget?.nom}</b> ? La suppression est refusée si un historique comptable existe (utilisez alors l'archivage).</>} />
    </div>
  );
}
