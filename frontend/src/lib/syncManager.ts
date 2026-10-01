import { ApiError, api } from '../api/client';
import {
  getActiveUserId,
  getMeta,
  getReadyQueue,
  getSyncSummary,
  listQueue,
  markQueueFailed,
  markQueueSynced,
  markQueueSyncing,
  mergeSyncPull,
  resetStaleSyncing,
  retryQueue,
  discardQueue,
  setMeta,
  type SyncQueueRecord,
  type SyncSummary,
} from './offlineDb';

export type SyncUiStatus = 'ONLINE' | 'OFFLINE' | 'SYNCHRONISATION' | 'SYNCHRONISÉ' | 'ÉCHEC';

export interface SyncState extends SyncSummary {
  status: SyncUiStatus;
  apiReachable: boolean | null;
  lastRunError: string | null;
}

const initialState: SyncState = {
  status: 'SYNCHRONISÉ',
  apiReachable: null,
  pending: 0,
  syncing: 0,
  failed: 0,
  synced: 0,
  total: 0,
  lastSyncAt: null,
  lastError: null,
  lastRunError: null,
  storageAvailable: false,
};

let state: SyncState = { ...initialState };
const listeners = new Set<(next: SyncState) => void>();
let running: Promise<SyncState> | null = null;

function publish(next: Partial<SyncState>): SyncState {
  state = { ...state, ...next };
  listeners.forEach((listener) => listener(state));
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('ap:sync-state', { detail: state }));
  return state;
}

async function refreshSummary(): Promise<SyncState> {
  try {
    const summary = await getSyncSummary();
    return publish(summary);
  } catch (error) {
    return publish({ storageAvailable: false, status: 'ÉCHEC', lastRunError: error instanceof Error ? error.message : String(error) });
  }
}

export function getSyncState(): SyncState {
  return state;
}

export function subscribeSync(listener: (next: SyncState) => void): () => void {
  listeners.add(listener);
  listener(state);
  return () => listeners.delete(listener);
}

export async function loadSyncState(): Promise<SyncState> {
  return refreshSummary();
}

export function setApiReachability(reachable: boolean): void {
  publish({ apiReachable: reachable, status: reachable ? (state.pending > 0 || state.failed > 0 ? state.status : 'ONLINE') : 'OFFLINE' });
}

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return String(error || 'Erreur de synchronisation');
}

function retryDecision(error: unknown): { retryable: boolean; delayMs: number } {
  const status = error instanceof ApiError ? error.status : 0;
  // Validation, permission and stock conflicts require an explicit user
  // decision. Network, timeout, throttling and temporary server failures retry.
  const retryable = status === 0 || status === 408 || status === 425 || status === 429 || status >= 500;
  return { retryable, delayMs: retryable ? 4_000 : 24 * 60 * 60 * 1000 };
}

async function pushOne(queue: SyncQueueRecord, activeUserId: number): Promise<void> {
  if (queue.ownerUserId && queue.ownerUserId !== activeUserId) {
    await markQueueFailed(queue.id, 'Opération créée par un autre compte local ; reconnexion avec ce compte requise.', false, new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString());
    return;
  }
  const syncing = await markQueueSyncing(queue.id);
  if (!syncing) return;
  try {
    let response: any;
    if (queue.operation === 'CREATE_VENTE') response = await api.post('/api/ventes', queue.payload);
    else if (queue.operation === 'ADJUST_STOCK') response = await api.post('/api/stock/ajustement', queue.payload);
    else throw new Error(`Opération de synchronisation inconnue : ${queue.operation}`);
    await markQueueSynced(queue.id, response);
  } catch (error) {
    const decision = retryDecision(error);
    const attempts = Number(queue.attempts || 0);
    const exponentialDelay = decision.retryable
      ? Math.min(15 * 60 * 1000, decision.delayMs * (2 ** Math.min(attempts, 6)))
      : decision.delayMs;
    await markQueueFailed(queue.id, errorMessage(error), decision.retryable, new Date(Date.now() + exponentialDelay).toISOString());
  }
}

async function runSyncInternal(): Promise<SyncState> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    await refreshSummary();
    return publish({ status: 'OFFLINE', apiReachable: false });
  }

  let activeUserId: number | undefined;
  try {
    activeUserId = await getActiveUserId();
  } catch (error) {
    const summary = await getSyncSummary().catch(() => initialState);
    return publish({ ...summary, status: 'ÉCHEC', lastRunError: errorMessage(error) });
  }
  if (!activeUserId) {
    const summary = await getSyncSummary();
    return publish({ ...summary, status: 'ONLINE', lastRunError: null });
  }

  publish({ status: 'SYNCHRONISATION', lastRunError: null });
  try {
    await resetStaleSyncing();
    const ready = await getReadyQueue();
    for (const queue of ready) {
      if (typeof navigator !== 'undefined' && !navigator.onLine) break;
      await pushOne(queue, activeUserId);
    }

    // Pull happens after writes so a local sale/adjustment is reconciled with
    // the authoritative server stock. A cursor is advanced only after both
    // stores have been written successfully.
    const since = await getMeta<string>('lastSyncAt');
    const suffix = since ? `?since=${encodeURIComponent(since)}` : '';
    const pull = await api.get(`/api/sync/pull${suffix}`);
    await mergeSyncPull(pull);
    await setMeta('lastSyncAt', pull.cursor || new Date().toISOString());
    await setMeta('lastSyncError', null);

    const summary = await getSyncSummary();
    const failed = summary.failed > 0;
    return publish({
      ...summary,
      apiReachable: true,
      status: failed ? 'ÉCHEC' : 'SYNCHRONISÉ',
      lastRunError: failed ? 'Certaines opérations demandent une résolution.' : null,
    });
  } catch (error) {
    const message = errorMessage(error);
    await setMeta('lastSyncError', message).catch(() => {});
    const summary = await getSyncSummary().catch(() => initialState);
    const reachable = !(error instanceof ApiError && error.status === 0);
    return publish({ ...summary, apiReachable: reachable, status: 'ÉCHEC', lastRunError: message, lastError: message });
  }
}

export function runSync(): Promise<SyncState> {
  if (running) return running;
  running = runSyncInternal().finally(() => { running = null; });
  return running;
}

export async function retrySyncQueue(queueId: string): Promise<SyncState> {
  await retryQueue(queueId);
  return runSync();
}

export async function discardSyncQueue(queueId: string): Promise<SyncState> {
  await discardQueue(queueId);
  return refreshSummary();
}

export async function getQueueForDashboard(): Promise<SyncQueueRecord[]> {
  return listQueue();
}
