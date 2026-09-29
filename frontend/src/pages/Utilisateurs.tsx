import { useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, KeyRound, ShieldCheck, UserX, UserCheck } from 'lucide-react';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { fmtDate, fmtDateTime } from '../lib/format';
import { Loading, Badge, Modal, Field, ConfirmDialog } from '../components/ui';
import { PERMISSIONS_INFO } from '../lib/permissions';

const empty = { nom: '', prenom: '', username: '', password: '', telephone: '', email: '', roleId: 'ASSISTANT', actif: true };

export default function Utilisateurs() {
  const { user, refreshUser } = useAuth();
  const { toast } = useToast();
  const [list, setList] = useState<any[] | null>(null);
  const [form, setForm] = useState<any>(empty);
  const [editId, setEditId] = useState<number | null>(null);
  const [open, setOpen] = useState(false);
  const [pwdTarget, setPwdTarget] = useState<any>(null);
  const [newPwd, setNewPwd] = useState('');
  const [delTarget, setDelTarget] = useState<any>(null);
  const [permOpen, setPermOpen] = useState(false);

  const load = () => api.get('/api/users').then(setList).catch((e) => toast('error', e.message));
  useEffect(() => { load(); }, []);

  const submit = async () => {
    if (!form.nom || !form.prenom || !form.username) return toast('error', 'Nom, prénom et identifiant obligatoires');
    if (!editId && form.password.length < 8) return toast('error', 'Mot de passe : 8 caractères min., 1 majuscule, 1 minuscule, 1 chiffre');
    try {
      if (editId) {
        const { password, ...rest } = form;
        await api.put(`/api/users/${editId}`, rest);
        toast('success', 'Utilisateur modifié');
      } else {
        await api.post('/api/users', form);
        toast('success', `Compte "${form.username}" créé`);
      }
      setOpen(false); load();
    } catch (e: any) {
      toast('error', e.details ? e.details.map((d: any) => d.message).join(' — ') : e.message);
    }
  };

  const resetPwd = async () => {
    try {
      await api.post(`/api/users/${pwdTarget.id}/reset-password`, { newPassword: newPwd });
      toast('success', 'Mot de passe réinitialisé');
      setNewPwd('');
    } catch (e: any) { toast('error', e.message); }
  };

  const del = async () => {
    try { const r = await api.del(`/api/users/${delTarget.id}`); toast('success', r.message); load(); }
    catch (e: any) { toast('error', e.message); }
  };

  const toggleActif = async (u: any) => {
    try {
      await api.put(`/api/users/${u.id}`, { actif: !u.actif });
      toast('success', u.actif ? 'Compte désactivé' : 'Compte réactivé');
      load();
    } catch (e: any) { toast('error', e.message); }
  };

  const roleBadge: Record<string, { cls: string; label: string }> = {
    ADMIN: { cls: 'bg-brand-100 text-brand-700', label: 'Administrateur' },
    FINANCE: { cls: 'bg-violet-100 text-violet-700', label: 'Financier' },
    ASSISTANT: { cls: 'bg-sky-100 text-sky-700', label: 'Assistant pharmacien' },
  };

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-800">Utilisateurs & permissions</h1>
          <p className="text-sm text-slate-500">Comptes administrateurs, financiers et assistants pharmaciens</p>
        </div>
        <div className="flex gap-2">
          <button className="btn-secondary" onClick={() => setPermOpen(true)}><ShieldCheck className="w-4 h-4" /> Matrice des permissions</button>
          <button className="btn-primary" onClick={() => { setForm(empty); setEditId(null); setOpen(true); }}>
            <Plus className="w-4 h-4" /> Nouvel utilisateur
          </button>
        </div>
      </div>

      {!list ? <Loading /> : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="th-static">Utilisateur</th><th className="th-static">Identifiant</th>
                  <th className="th-static">Rôle</th><th className="th-static">Téléphone</th>
                  <th className="th-static">Créé le</th><th className="th-static">Dernière connexion</th>
                  <th className="th-static">Statut</th><th className="th-static w-36">Actions</th>
                </tr>
              </thead>
              <tbody>
                {list.map((u) => (
                  <tr key={u.id} className="tr-hover">
                    <td className="td">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-full bg-gradient-to-br from-brand-500 to-brand-700 text-white flex items-center justify-center text-xs font-bold shrink-0">
                          {u.prenom?.[0]}{u.nom?.[0]}
                        </div>
                        <div>
                          <p className="font-semibold text-slate-800">{u.prenom} {u.nom}</p>
                          {u.email && <p className="text-xs text-slate-400">{u.email}</p>}
                        </div>
                      </div>
                    </td>
                    <td className="td font-mono text-xs">@{u.username}</td>
                    <td className="td"><span className={`badge ${roleBadge[u.roleId]?.cls}`}>{roleBadge[u.roleId]?.label}</span></td>
                    <td className="td text-xs">{u.telephone || '—'}</td>
                    <td className="td text-xs">{fmtDate(u.createdAt)}</td>
                    <td className="td text-xs">{u.lastLoginAt ? fmtDateTime(u.lastLoginAt) : 'Jamais'}</td>
                    <td className="td">
                      <span className={`badge ${u.actif ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-500'}`}>
                        {u.actif ? '● Actif' : '○ Inactif'}
                      </span>
                    </td>
                    <td className="td">
                      <div className="flex gap-1">
                        <button className="p-1.5 rounded-md hover:bg-brand-50 text-brand-600" title="Modifier"
                          onClick={() => { setEditId(u.id); setForm({ ...u, password: '' }); setOpen(true); }}><Pencil className="w-4 h-4" /></button>
                        <button className="p-1.5 rounded-md hover:bg-amber-50 text-amber-600" title="Réinitialiser le mot de passe"
                          onClick={() => { setPwdTarget(u); setNewPwd(''); }}><KeyRound className="w-4 h-4" /></button>
                        {u.username !== 'admin' && u.id !== user?.id && (
                          <>
                            <button className={`p-1.5 rounded-md hover:bg-slate-100 ${u.actif ? 'text-slate-500' : 'text-emerald-600'}`}
                              title={u.actif ? 'Désactiver' : 'Réactiver'} onClick={() => toggleActif(u)}>
                              {u.actif ? <UserX className="w-4 h-4" /> : <UserCheck className="w-4 h-4" />}
                            </button>
                            <button className="p-1.5 rounded-md hover:bg-red-50 text-red-500" title="Supprimer"
                              onClick={() => setDelTarget(u)}><Trash2 className="w-4 h-4" /></button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Création / édition */}
      <Modal open={open} onClose={() => setOpen(false)} title={editId ? 'Modifier l\'utilisateur' : 'Nouvel utilisateur'} wide>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Nom" required><input className="input" value={form.nom} onChange={(e) => setForm({ ...form, nom: e.target.value })} /></Field>
          <Field label="Prénom" required><input className="input" value={form.prenom} onChange={(e) => setForm({ ...form, prenom: e.target.value })} /></Field>
          <Field label="Nom d'utilisateur" required>
            <input className="input font-mono" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })}
              disabled={!!editId && form.username === 'admin'} placeholder="ex : g.mukendi" />
          </Field>
          {!editId && (
            <Field label="Mot de passe initial" required>
              <input type="password" className="input" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })}
                placeholder="8+ car., majuscule, chiffre" />
            </Field>
          )}
          <Field label="Téléphone"><input className="input" value={form.telephone || ''} onChange={(e) => setForm({ ...form, telephone: e.target.value })} /></Field>
          <Field label="Email"><input className="input" type="email" value={form.email || ''} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
          <Field label="Rôle" required>
            <select className="input" value={form.roleId} onChange={(e) => setForm({ ...form, roleId: e.target.value })}>
              <option value="ASSISTANT">Assistant pharmacien</option>
              <option value="FINANCE">Financier</option>
              <option value="ADMIN">Administrateur</option>
            </select>
          </Field>
          <Field label="Statut">
            <select className="input" value={form.actif ? '1' : '0'} onChange={(e) => setForm({ ...form, actif: e.target.value === '1' })}>
              <option value="1">Actif</option>
              <option value="0">Inactif</option>
            </select>
          </Field>
        </div>
        <p className="text-xs text-slate-400 mt-3">🔐 Les mots de passe sont hachés (bcrypt, 12 rounds) — jamais stockés en clair.</p>
        <div className="flex justify-end gap-2 mt-4">
          <button className="btn-secondary" onClick={() => setOpen(false)}>Annuler</button>
          <button className="btn-primary" onClick={submit}>{editId ? 'Enregistrer' : 'Créer le compte'}</button>
        </div>
      </Modal>

      {/* Reset password */}
      <Modal open={!!pwdTarget} onClose={() => setPwdTarget(null)} title={`Réinitialiser le mot de passe — @${pwdTarget?.username || ''}`}>
        <Field label="Nouveau mot de passe" required>
          <input type="password" className="input" value={newPwd} onChange={(e) => setNewPwd(e.target.value)} placeholder="8+ caractères" />
        </Field>
        <div className="flex justify-end gap-2 mt-4">
          <button className="btn-secondary" onClick={() => setPwdTarget(null)}>Annuler</button>
          <button className="btn-primary" disabled={newPwd.length < 8} onClick={resetPwd}>Réinitialiser</button>
        </div>
      </Modal>

      {/* Matrice permissions */}
      <Modal open={permOpen} onClose={() => setPermOpen(false)} title="Matrice des permissions par rôle" wide>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className="th-static">Module</th><th className="th-static text-center">ADMIN</th>
                <th className="th-static text-center">FINANCE</th><th className="th-static text-center">ASSISTANT</th>
              </tr>
            </thead>
            <tbody>
              {PERMISSIONS_INFO.map((row) => (
                <tr key={row.module} className="tr-hover">
                  <td className="td font-medium">{row.label}</td>
                  {(['ADMIN', 'FINANCE', 'ASSISTANT'] as const).map((r) => (
                    <td key={r} className="td text-center">
                      {row[r] === 'full' ? <span className="text-emerald-600 font-bold">✓</span>
                        : row[r] === 'read' ? <span className="text-sky-600 font-semibold text-xs">lecture</span>
                        : <span className="text-red-400 font-bold">✗</span>}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Modal>

      <ConfirmDialog open={!!delTarget} onClose={() => setDelTarget(null)} onConfirm={del} danger
        title="Supprimer l'utilisateur" confirmLabel="Supprimer"
        message={<><b>{delTarget?.prenom} {delTarget?.nom}</b> sera supprimé, ou désactivé si un historique d'opérations existe (traçabilité comptable).</>} />
    </div>
  );
}
