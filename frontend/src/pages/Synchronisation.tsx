import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, CloudOff, Database, RefreshCw, RotateCcw, Trash2, UploadCloud } from 'lucide-react';
import { useNetwork } from '../context/NetworkContext';
import { discardSyncQueue, getQueueForDashboard, retrySyncQueue } from '../lib/syncManager';
import type { SyncQueueRecord } from '../lib/offlineDb';
import { fmtMoney } from '../lib/format';

const statusStyle: Record<string, string> = {
  PENDING: 'bg-amber-100 text-amber-800',
  SYNCING: 'bg-sky-100 text-sky-800',
  SYNCED: 'bg-emerald-100 text-emerald-800',
  FAILED: 'bg-red-100 text-red-800',
};

function queueLabel(item: SyncQueueRecord): string {
  if (item.operation === 'CREATE_VENTE') {
    const total = item.payload?.montantRecu ?? item.payload?.items?.reduce((sum: number, line: any) => sum + Number(line.prixUnitaire || 0) * Number(line.quantite || 0), 0);
    return `Facture offline · ${fmtMoney(total || 0)}`;
  }
  return `Ajustement de stock · médicament #${item.payload?.medicamentId ?? '—'} → ${item.payload?.nouveauStock ?? '—'}`;
}

export default function Synchronisation() {
  const network = useNetwork();
  const [queue, setQueue] = useState<SyncQueueRecord[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setQueue(await getQueueForDashboard().catch(() => []));
  }, []);

  useEffect(() => { void load(); }, [load, network.syncStatus, network.pendingOperations, network.failedOperations]);

  const manualSync = async () => {
    await network.syncNow();
    await load();
  };

  const retry = async (id: string) => {
    setBusyId(id);
    try { await retrySyncQueue(id); } finally { setBusyId(null); await load(); }
  };

  const discard = async (id: string) => {
    if (!window.confirm('Annuler cette opération locale ? Le stock réservé sera restauré et rien ne sera envoyé au serveur.')) return;
    setBusyId(id);
    try { await discardSyncQueue(id); } finally { setBusyId(null); await load(); }
  };

  const last = network.lastSyncAt ? new Date(network.lastSyncAt).toLocaleString('fr-FR') : 'Jamais';
  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-800 flex items-center gap-2"><RefreshCw className="w-6 h-6 text-brand-600" /> Synchronisation</h1>
          <p className="text-sm text-slate-500">État réel de l’API, base locale, file durable et conflits.</p>
        </div>
        <button className="btn-primary" onClick={() => void manualSync()} disabled={network.syncStatus === 'SYNCHRONISATION'}>
          <UploadCloud className="w-4 h-4" /> {network.syncStatus === 'SYNCHRONISATION' ? 'Synchronisation…' : 'Synchroniser maintenant'}
        </button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <StateCard label="État UI" value={!network.online ? 'OFFLINE' : network.syncStatus} icon={!network.online ? <CloudOff /> : network.syncStatus === 'ÉCHEC' ? <AlertCircle /> : <CheckCircle2 />} />
        <StateCard label="API" value={network.apiReachable === true ? 'JOIGNABLE' : network.apiReachable === false ? 'INJOIGNABLE' : 'NON TESTÉE'} icon={<UploadCloud />} />
        <StateCard label="En attente" value={String(network.pendingOperations)} icon={<RefreshCw />} />
        <StateCard label="Échecs / conflits" value={String(network.failedOperations)} icon={<AlertCircle />} />
        <StateCard label="Base locale" value={network.storageAvailable ? 'PERSISTANTE' : 'INDISPONIBLE'} icon={<Database />} />
      </div>

      <div className="card p-4 text-sm text-slate-600 grid md:grid-cols-2 gap-2">
        <p><b>Dernière synchronisation :</b> {last}</p>
        <p><b>Type de connexion :</b> {network.connectionType}</p>
        {network.syncError && <p className="md:col-span-2 text-red-700"><b>Dernière erreur :</b> {network.syncError}</p>}
        <p className="md:col-span-2 text-xs text-slate-500">Le signal Wi-Fi n’est jamais utilisé seul : l’état API provient d’une requête HTTPS/HTTP configurée vers le backend.</p>
      </div>

      <div className="card overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
          <div><h2 className="font-bold text-slate-700">File sync_queue</h2><p className="text-xs text-slate-400">UUID stable · retries · backoff · idempotence serveur</p></div>
          <span className="text-xs text-slate-400">{queue.length} opération(s)</span>
        </div>
        {queue.length === 0 ? <p className="p-8 text-center text-sm text-slate-400">Aucune opération locale enregistrée.</p> : (
          <div className="divide-y divide-slate-100">
            {queue.map((item) => (
              <div key={item.id} className="p-4 flex flex-col lg:flex-row lg:items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex gap-2 items-center flex-wrap">
                    <span className={`badge ${statusStyle[item.status] || 'bg-slate-100 text-slate-700'}`}>{item.status}</span>
                    <span className="font-semibold text-sm text-slate-700">{queueLabel(item)}</span>
                    {item.retryable === false && <span className="badge bg-red-50 text-red-700">résolution requise</span>}
                  </div>
                  <p className="text-[11px] text-slate-400 font-mono mt-1 break-all">UUID : {item.entityId}</p>
                  {item.lastError && <p className="text-xs text-red-600 mt-1">{item.lastError}</p>}
                  <p className="text-[11px] text-slate-400 mt-1">Tentatives : {item.attempts} · Créé : {new Date(item.createdAt).toLocaleString('fr-FR')}</p>
                </div>
                {item.status === 'FAILED' && (
                  <div className="flex gap-2 shrink-0">
                    <button className="btn-secondary btn-sm" disabled={busyId === item.id} onClick={() => void retry(item.id)}><RotateCcw className="w-3.5 h-3.5" /> Réessayer</button>
                    <button className="btn-danger btn-sm" disabled={busyId === item.id} onClick={() => void discard(item.id)}><Trash2 className="w-3.5 h-3.5" /> Annuler localement</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function StateCard({ label, value, icon }: { label: string; value: string; icon: JSX.Element }) {
  return <div className="card p-3"><div className="flex items-center gap-2 text-brand-600"><span className="w-4 h-4">{icon}</span><span className="text-[11px] font-bold uppercase text-slate-400">{label}</span></div><p className="mt-2 font-extrabold text-slate-800 text-sm break-words">{value}</p></div>;
}
