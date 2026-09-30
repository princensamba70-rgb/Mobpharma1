import { useState } from 'react';
import { CheckCircle2, ChevronDown, Server, Wifi, WifiOff } from 'lucide-react';
import { api, getApiOrigin, isNativeApp, resetApiOrigin, setApiOrigin } from '../api/client';
import { useNetwork } from '../context/NetworkContext';
import { useToast } from '../context/ToastContext';

/**
 * Mobile-only endpoint configuration. It contains no credential or secret; it
 * lets an installed APK target the pharmacy API hosted by the organisation.
 */
export default function ServerEndpoint() {
  const { online } = useNetwork();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(getApiOrigin());
  const [busy, setBusy] = useState(false);
  const [checked, setChecked] = useState(false);

  if (!isNativeApp()) return null;

  const test = async () => {
    setBusy(true);
    setChecked(false);
    try {
      setApiOrigin(value);
      await api.get('/api/health');
      setChecked(true);
      toast('success', 'Serveur AMI PHARMA accessible.');
    } catch (error: any) {
      toast('error', error.message || 'Serveur inaccessible.');
    } finally { setBusy(false); }
  };

  const reset = () => {
    resetApiOrigin();
    setValue(getApiOrigin());
    setChecked(false);
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3 text-left">
      <button type="button" className="flex w-full items-center justify-between gap-3 text-sm font-semibold text-slate-700"
        onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="flex items-center gap-2"><Server className="h-4 w-4 text-brand-600" /> Serveur de données</span>
        <span className="flex items-center gap-2 text-xs font-medium text-slate-400">
          {online ? <Wifi className="h-3.5 w-3.5 text-emerald-500" /> : <WifiOff className="h-3.5 w-3.5 text-amber-500" />}
          <ChevronDown className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} />
        </span>
      </button>
      {open && (
        <div className="mt-3 space-y-2">
          <label className="label" htmlFor="api-endpoint">URL HTTPS de l’API</label>
          <input id="api-endpoint" className="input" type="url" inputMode="url" autoCapitalize="none" autoCorrect="off"
            value={value} onChange={(event) => { setValue(event.target.value); setChecked(false); }}
            placeholder="https://api.exemple.cd" />
          <p className="text-[11px] leading-relaxed text-slate-400">
            Saisissez l’adresse du serveur, sans <code>/api</code>. Pour l’émulateur Android local : <code>http://10.0.2.2:4000</code>.
            Une URL HTTPS est obligatoire en production.
          </p>
          <div className="flex flex-wrap gap-2 pt-1">
            <button type="button" className="btn-primary btn-sm" onClick={test} disabled={busy || !value.trim()}>
              {busy ? 'Test…' : <><Wifi className="h-3.5 w-3.5" /> Tester et enregistrer</>}
            </button>
            <button type="button" className="btn-secondary btn-sm" onClick={reset}>Réinitialiser</button>
            {checked && <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-600"><CheckCircle2 className="h-4 w-4" /> Connecté</span>}
          </div>
        </div>
      )}
    </div>
  );
}
