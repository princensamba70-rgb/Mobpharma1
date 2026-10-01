import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Network, type ConnectionStatus } from '@capacitor/network';
import { api, AUTH_REQUEST_TIMEOUT_MS } from '../api/client';
import {
  getSyncState,
  loadSyncState,
  runSync,
  setApiReachability,
  subscribeSync,
  type SyncState,
  type SyncUiStatus,
} from '../lib/syncManager';

interface NetworkState {
  /** Browser/device transport state, not proof that the API is reachable. */
  online: boolean;
  apiReachable: boolean | null;
  connectionType: string;
  staleData: boolean;
  syncStatus: SyncUiStatus;
  lastSyncAt: string | null;
  pendingOperations: number;
  failedOperations: number;
  syncError: string | null;
  storageAvailable: boolean;
  syncNow: () => Promise<SyncState>;
}

const defaultState: NetworkState = {
  online: true,
  apiReachable: null,
  connectionType: 'unknown',
  staleData: false,
  syncStatus: 'SYNCHRONISÉ',
  lastSyncAt: null,
  pendingOperations: 0,
  failedOperations: 0,
  syncError: null,
  storageAvailable: false,
  syncNow: () => Promise.resolve(getSyncState()),
};

const NetworkCtx = createContext<NetworkState>(defaultState);
export const useNetwork = () => useContext(NetworkCtx);

function browserOnline(): boolean {
  return typeof navigator === 'undefined' ? true : navigator.onLine;
}

export function NetworkProvider({ children }: { children: ReactNode }) {
  const [transportOnline, setTransportOnline] = useState(browserOnline);
  const [apiReachable, setApiReachable] = useState<boolean | null>(null);
  const [connectionType, setConnectionType] = useState('unknown');
  const [sync, setSync] = useState<SyncState>(getSyncState());

  useEffect(() => {
    let mounted = true;
    let syncTimer: number | undefined;
    const applyTransport = (status: Pick<ConnectionStatus, 'connected' | 'connectionType'>) => {
      if (!mounted) return;
      setTransportOnline(status.connected);
      setConnectionType(status.connectionType);
      if (!status.connected) {
        setApiReachable(false);
        setApiReachability(false);
      }
    };

    const scheduleSync = (delay = 250) => {
      window.clearTimeout(syncTimer);
      syncTimer = window.setTimeout(() => { void runSync(); }, delay);
    };

    const probeApi = async () => {
      if (!browserOnline()) {
        setApiReachable(false);
        setApiReachability(false);
        return;
      }
      try {
        // This probe is intentionally a real API request. Wi-Fi/Capacitor's
        // connected flag alone is never treated as server availability.
        await api.get('/api/health', { timeoutMs: AUTH_REQUEST_TIMEOUT_MS });
        if (!mounted) return;
        setApiReachable(true);
        setApiReachability(true);
        scheduleSync();
      } catch {
        if (!mounted) return;
        setApiReachable(false);
        setApiReachability(false);
      }
    };

    const onBrowserOnline = () => { setTransportOnline(true); setApiReachable(null); void probeApi(); };
    const onBrowserOffline = () => { setTransportOnline(false); setApiReachable(false); setApiReachability(false); };
    const onApiOnline = () => { setApiReachable(true); setApiReachability(true); scheduleSync(); };
    const onApiOffline = () => { setApiReachable(false); setApiReachability(false); };
    const onAuthReady = () => scheduleSync(50);
    const unsubscribe = subscribeSync((next) => { if (mounted) setSync(next); });

    window.addEventListener('online', onBrowserOnline);
    window.addEventListener('offline', onBrowserOffline);
    window.addEventListener('ap:api-online', onApiOnline);
    window.addEventListener('ap:api-offline', onApiOffline);
    window.addEventListener('ap:auth-ready', onAuthReady);
    Network.getStatus().then(applyTransport).catch(() => { /* browser events remain authoritative */ });
    void loadSyncState();
    void probeApi();
    const listener = Network.addListener('networkStatusChange', applyTransport).catch(() => null);
    const interval = window.setInterval(() => { void probeApi(); }, 60_000);

    return () => {
      mounted = false;
      window.clearTimeout(syncTimer);
      window.clearInterval(interval);
      unsubscribe();
      window.removeEventListener('online', onBrowserOnline);
      window.removeEventListener('offline', onBrowserOffline);
      window.removeEventListener('ap:api-online', onApiOnline);
      window.removeEventListener('ap:api-offline', onApiOffline);
      window.removeEventListener('ap:auth-ready', onAuthReady);
      listener.then((handle) => handle?.remove()).catch(() => {});
    };
  }, []);

  const value = useMemo<NetworkState>(() => {
    const actualOnline = transportOnline && apiReachable !== false;
    const status = !transportOnline ? 'OFFLINE' : sync.status;
    return {
      online: actualOnline,
      apiReachable,
      connectionType,
      staleData: !actualOnline || sync.pending > 0 || sync.failed > 0,
      syncStatus: status,
      lastSyncAt: sync.lastSyncAt,
      pendingOperations: sync.pending + sync.syncing,
      failedOperations: sync.failed,
      syncError: sync.lastRunError || sync.lastError,
      storageAvailable: sync.storageAvailable,
      syncNow: runSync,
    };
  }, [transportOnline, apiReachable, connectionType, sync]);

  return <NetworkCtx.Provider value={value}>{children}</NetworkCtx.Provider>;
}
