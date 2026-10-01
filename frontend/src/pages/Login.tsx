import { useState, FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { LogIn, Eye, EyeOff, ShieldCheck } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import ServerEndpoint from '../components/ServerEndpoint';
import { getSessionStorageStatus } from '../lib/secureStorage';

export default function Login() {
  const { login } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const user = await login(username.trim(), password);
      const sessionStorage = getSessionStorageStatus();
      toast('success', `Bonjour ${user.prenom} ${user.nom} !`);
      if (sessionStorage.mode === 'memory') {
        toast('warning', sessionStorage.warning || 'La session ne sera pas conservée après le redémarrage.');
      }
      navigate('/', { replace: true });
    } catch (err: any) {
      setError(err.message || 'Erreur de connexion');
    } finally { setBusy(false); }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-brand-950 to-slate-900 p-4 relative overflow-hidden">
      {/* décor */}
      <div className="absolute inset-0 opacity-10 pointer-events-none"
        style={{ backgroundImage: 'radial-gradient(circle at 20% 30%, #14b8a6 0, transparent 40%), radial-gradient(circle at 80% 70%, #0ea5e9 0, transparent 40%)' }} />
      <div className="absolute top-10 left-10 text-white/5 select-none pointer-events-none">
        <svg width="180" height="180" viewBox="0 0 100 100"><rect x="42" y="10" width="16" height="80" rx="5" fill="currentColor" /><rect x="10" y="42" width="80" height="16" rx="5" fill="currentColor" /></svg>
      </div>

      <div className="w-full max-w-md relative animate-scale-in">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center mb-4">
            <svg width="72" height="72" viewBox="0 0 100 100">
              <rect width="100" height="100" rx="24" fill="#0d9488" />
              <rect x="42" y="16" width="16" height="68" rx="5" fill="white" />
              <rect x="16" y="42" width="68" height="16" rx="5" fill="white" />
            </svg>
          </div>
          <h1 className="text-3xl font-extrabold text-white tracking-wide">AMI PHARMA</h1>
          <p className="text-brand-300 text-sm mt-1 font-medium">Système intégré de gestion de pharmacie</p>
        </div>

        <form onSubmit={submit} className="bg-white rounded-2xl shadow-2xl p-7 space-y-5">
          <div>
            <h2 className="text-lg font-bold text-slate-800">Connexion</h2>
            <p className="text-xs text-slate-400 mt-0.5">Accédez à votre espace sécurisé</p>
          </div>

          {error && (
            <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700 flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 shrink-0" /> {error}
            </div>
          )}

          <div>
            <label className="label">Nom d'utilisateur</label>
            <input className="input" value={username} onChange={(e) => setUsername(e.target.value)}
              placeholder="admin" autoComplete="username" autoFocus required />
          </div>
          <div>
            <label className="label">Mot de passe</label>
            <div className="relative">
              <input className="input pr-10" type={show ? 'text' : 'password'} value={password}
                onChange={(e) => setPassword(e.target.value)} placeholder="••••••••"
                autoComplete="current-password" required />
              <button type="button" onClick={() => setShow(!show)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <button type="submit" disabled={busy} className="btn-primary w-full py-2.5">
            {busy ? <span className="animate-pulse">Connexion…</span> : <><LogIn className="w-4 h-4" /> Se connecter</>}
          </button>

          <p className="text-[11px] text-center text-slate-400 leading-relaxed">
            🔐 Connexion sécurisée — mots de passe hachés (bcrypt), sessions JWT.<br />
            Devise : CDF · Kinshasa / RDC
          </p>
          <ServerEndpoint />
        </form>
      </div>
    </div>
  );
}
