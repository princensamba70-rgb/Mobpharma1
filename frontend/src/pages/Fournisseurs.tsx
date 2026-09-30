import { useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, Building2, Phone, MapPin } from 'lucide-react';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { Loading, Modal, Field, ConfirmDialog } from '../components/ui';

const empty = { nom: '', telephone: '', email: '', adresse: '', actif: true };

export default function Fournisseurs() {
  const { can } = useAuth();
  const { toast } = useToast();
  const [list, setList] = useState<any[] | null>(null);
  const [form, setForm] = useState<any>(empty);
  const [editId, setEditId] = useState<number | null>(null);
  const [open, setOpen] = useState(false);
  const [delTarget, setDelTarget] = useState<any>(null);
  const canEdit = can('fournisseurs', 'full');

  const load = () => api.get('/api/fournisseurs').then(setList).catch((e) => toast('error', e.message));
  useEffect(() => { load(); }, []);

  const submit = async () => {
    if (!form.nom.trim()) return toast('error', 'Nom obligatoire');
    try {
      if (editId) { await api.put(`/api/fournisseurs/${editId}`, form); toast('success', 'Fournisseur modifié'); }
      else { await api.post('/api/fournisseurs', form); toast('success', 'Fournisseur ajouté'); }
      setOpen(false); load();
    } catch (e: any) { toast('error', e.message); }
  };

  const del = async () => {
    try { const r = await api.del(`/api/fournisseurs/${delTarget.id}`); toast('success', r.message); load(); }
    catch (e: any) { toast('error', e.message); }
  };

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-800">Fournisseurs</h1>
          <p className="text-sm text-slate-500">Partenaires d'approvisionnement</p>
        </div>
        {canEdit && (
          <button className="btn-primary" onClick={() => { setForm(empty); setEditId(null); setOpen(true); }}>
            <Plus className="w-4 h-4" /> Nouveau fournisseur
          </button>
        )}
      </div>

      {!list ? <Loading /> : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {list.map((f) => (
            <div key={f.id} className={`card p-5 card-hover ${!f.actif ? 'opacity-50' : ''}`}>
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-brand-100 text-brand-700 flex items-center justify-center">
                    <Building2 className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="font-bold text-slate-800">{f.nom}</p>
                    <p className="text-xs text-slate-400">{f._count?.approvisionnements || 0} approvisionnement(s)</p>
                  </div>
                </div>
                {canEdit && (
                  <div className="flex gap-1">
                    <button className="p-1.5 rounded-md hover:bg-brand-50 text-brand-600" onClick={() => { setForm({ ...f, email: f.email || '' }); setEditId(f.id); setOpen(true); }}><Pencil className="w-4 h-4" /></button>
                    <button className="p-1.5 rounded-md hover:bg-red-50 text-red-500" onClick={() => setDelTarget(f)}><Trash2 className="w-4 h-4" /></button>
                  </div>
                )}
              </div>
              <div className="mt-3 space-y-1.5 text-sm text-slate-500">
                {f.telephone && <p className="flex items-center gap-2"><Phone className="w-3.5 h-3.5" /> {f.telephone}</p>}
                {f.adresse && <p className="flex items-center gap-2"><MapPin className="w-3.5 h-3.5" /> {f.adresse}</p>}
                {f.email && <p className="text-xs">✉️ {f.email}</p>}
              </div>
              {!f.actif && <p className="mt-2 text-xs font-bold text-red-500">DÉSACTIVÉ</p>}
            </div>
          ))}
          {list.length === 0 && <p className="text-slate-400 text-sm col-span-full text-center py-10">Aucun fournisseur</p>}
        </div>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title={editId ? 'Modifier le fournisseur' : 'Nouveau fournisseur'}>
        <div className="space-y-4">
          <Field label="Nom" required><input className="input" value={form.nom} onChange={(e) => setForm({ ...form, nom: e.target.value })} /></Field>
          <Field label="Téléphone"><input className="input" value={form.telephone || ''} onChange={(e) => setForm({ ...form, telephone: e.target.value })} /></Field>
          <Field label="Email"><input className="input" type="email" value={form.email || ''} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
          <Field label="Adresse"><input className="input" value={form.adresse || ''} onChange={(e) => setForm({ ...form, adresse: e.target.value })} /></Field>
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" checked={form.actif} onChange={(e) => setForm({ ...form, actif: e.target.checked })} className="rounded border-slate-300 text-brand-600" /> Actif
          </label>
          <div className="flex justify-end gap-2">
            <button className="btn-secondary" onClick={() => setOpen(false)}>Annuler</button>
            <button className="btn-primary" onClick={submit}>Enregistrer</button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog open={!!delTarget} onClose={() => setDelTarget(null)} onConfirm={del} danger
        title="Supprimer le fournisseur" confirmLabel="Supprimer"
        message={<><b>{delTarget?.nom}</b> sera supprimé (ou désactivé si un historique existe).</>} />
    </div>
  );
}
