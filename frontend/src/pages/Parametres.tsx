import { useEffect, useState } from 'react';
import { Settings, Building2, CalendarClock, PackagePlus, Globe, ShieldCheck } from 'lucide-react';
import { api } from '../api/client';
import { useToast } from '../context/ToastContext';
import { Loading, Field } from '../components/ui';

export default function Parametres() {
  const { toast } = useToast();
  const [data, setData] = useState<any>(null);
  const [form, setForm] = useState<any>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get('/api/settings').then((d) => {
      setData(d);
      setForm({
        pharmacie: { ...d.pharmacie },
        expirationSeuils: [...d.expirationSeuils],
        reapproFacteur: d.reapproFacteur,
        devise: d.devise,
        langue: d.langue,
      });
    }).catch((e) => toast('error', e.message));
  }, []);

  if (!form) return <Loading />;

  const save = async () => {
    setBusy(true);
    try {
      await api.put('/api/settings', form);
      toast('success', 'Paramètres enregistrés');
    } catch (e: any) { toast('error', e.message); } finally { setBusy(false); }
  };

  const seuils = form.expirationSeuils;
  const setSeuil = (i: number, v: number) => {
    const s = [...seuils]; s[i] = v;
    setForm({ ...form, expirationSeuils: s.filter((x: number) => x > 0).sort((a: number, b: number) => b - a) });
  };

  return (
    <div className="space-y-5 animate-fade-in max-w-4xl">
      <div>
        <h1 className="text-2xl font-extrabold text-slate-800 flex items-center gap-2">
          <Settings className="w-6 h-6 text-brand-600" /> Paramètres
        </h1>
        <p className="text-sm text-slate-500">Configuration réservée à l'administrateur</p>
      </div>

      <div className="card p-5 space-y-4">
        <h3 className="font-bold text-slate-700 flex items-center gap-2"><Building2 className="w-4 h-4 text-brand-600" /> Identité de la pharmacie</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Nom"><input className="input" value={form.pharmacie.nom} onChange={(e) => setForm({ ...form, pharmacie: { ...form.pharmacie, nom: e.target.value } })} /></Field>
          <Field label="Slogan"><input className="input" value={form.pharmacie.slogan} onChange={(e) => setForm({ ...form, pharmacie: { ...form.pharmacie, slogan: e.target.value } })} /></Field>
          <Field label="Adresse" className="md:col-span-2"><input className="input" value={form.pharmacie.adresse} onChange={(e) => setForm({ ...form, pharmacie: { ...form.pharmacie, adresse: e.target.value } })} /></Field>
          <Field label="Ville / Pays"><input className="input" value={form.pharmacie.ville} onChange={(e) => setForm({ ...form, pharmacie: { ...form.pharmacie, ville: e.target.value } })} /></Field>
          <Field label="Téléphone"><input className="input" value={form.pharmacie.telephone} onChange={(e) => setForm({ ...form, pharmacie: { ...form.pharmacie, telephone: e.target.value } })} /></Field>
        </div>
      </div>

      <div className="card p-5 space-y-4">
        <h3 className="font-bold text-slate-700 flex items-center gap-2"><CalendarClock className="w-4 h-4 text-orange-500" /> Seuils d'alerte d'expiration (jours)</h3>
        <div className="flex gap-3 flex-wrap">
          {seuils.map((s: number, i: number) => (
            <div key={i} className="flex items-center gap-2">
              <input type="number" min={1} max={720} className="input w-24" value={s} onChange={(e) => setSeuil(i, parseInt(e.target.value) || 0)} />
              <span className="text-xs text-slate-400">jours</span>
            </div>
          ))}
          {seuils.length < 6 && (
            <button className="btn-secondary btn-sm" onClick={() => setForm({ ...form, expirationSeuils: [...seuils, 15].sort((a: number, b: number) => b - a) })}>+ Ajouter un seuil</button>
          )}
        </div>
        <p className="text-xs text-slate-400">Alertes générées automatiquement : « Expiration dans {seuils.join(' / ')} jours » + produits expirés.</p>
      </div>

      <div className="card p-5 space-y-4">
        <h3 className="font-bold text-slate-700 flex items-center gap-2"><PackagePlus className="w-4 h-4 text-brand-600" /> Réapprovisionnement</h3>
        <Field label="Facteur de stock cible (quantité à commander = stock minimal × facteur − stock actuel)">
          <input type="number" min={1} max={10} step="0.5" className="input w-32" value={form.reapproFacteur}
            onChange={(e) => setForm({ ...form, reapproFacteur: parseFloat(e.target.value) || 2 })} />
        </Field>
      </div>

      <div className="card p-5 space-y-4">
        <h3 className="font-bold text-slate-700 flex items-center gap-2"><Globe className="w-4 h-4 text-sky-500" /> Devise & langue</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Devise principale">
            <select className="input" value={form.devise} onChange={(e) => setForm({ ...form, devise: e.target.value })}>
              <option value="CDF">CDF — Franc congolais</option>
              <option value="USD">USD — Dollar américain (futur)</option>
            </select>
          </Field>
          <Field label="Langue">
            <select className="input" value={form.langue} onChange={(e) => setForm({ ...form, langue: e.target.value })}>
              <option value="fr">Français</option>
              <option value="en">English (futur)</option>
            </select>
          </Field>
        </div>
        <p className="text-xs text-slate-400">L'architecture permet d'ajouter d'autres devises et langues ultérieurement.</p>
      </div>

      <div className="card p-5 space-y-3">
        <h3 className="font-bold text-slate-700 flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-emerald-600" /> Sécurité</h3>
        <ul className="text-sm text-slate-600 space-y-1.5 list-disc pl-5">
          <li>Mots de passe hachés avec bcrypt (12 rounds) — jamais stockés en clair.</li>
          <li>Sessions JWT : access token en mémoire + refresh token protégé (Keystore natif ou cookie httpOnly navigateur, 7 jours).</li>
          <li>Contrôle d'accès basé sur les rôles (ADMIN / FINANCE / ASSISTANT) appliqué côté serveur.</li>
          <li>Requêtes paramétrées via l'ORM Prisma (protection injection SQL), échappement React (protection XSS).</li>
          <li>Limitation de fréquence sur la connexion et l'API, journal d'audit complet.</li>
        </ul>
      </div>

      <div className="flex justify-end">
        <button className="btn-primary py-3 px-8" disabled={busy} onClick={save}>
          {busy ? 'Enregistrement…' : '💾 Enregistrer les paramètres'}
        </button>
      </div>
    </div>
  );
}
