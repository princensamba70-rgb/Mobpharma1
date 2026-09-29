import { createContext, useContext, useEffect, useMemo, useState, ReactNode } from 'react';
import { Network, type ConnectionStatus } from '@capacitor/network';

interface NetworkState {
  online: boolean;
  connectionType: string;
  staleData: boolean;
}

const NetworkCtx = createContext<NetworkState>({ online: true, connectionType: 'unknown', staleData: false });
export const useNetwork = () => useContext(NetworkCtx);

export function NetworkProvider({ children }: { children: ReactNode }) {
  const [online, setOnline] = useState(() => typeof navigator === 'undefined' ? true : navigator.onLine);
  const [connectionType, setConnectionType] = useState('unknown');
  const [staleData, setStaleData] = useState(false);

  useEffect(() => {
    let mounted = true;
    const apply = (status: Pick<ConnectionStatus, 'connected' | 'connectionType'>) => {
      if (!mounted) return;
      setOnline(status.connected);
      setConnectionType(status.connectionType);
      if (status.connected) setStaleData(false);
    };

    const onBrowserOnline = () => { setOnline(true); setStaleData(false); };
    const onBrowserOffline = () => setOnline(false);
    const onApiOnline = () => { setOnline(true); setStaleData(false); };
    const onApiOffline = () => setOnline(false);
    const onStaleData = () => setStaleData(true);

    window.addEventListener('online', onBrowserOnline);
    window.addEventListener('offline', onBrowserOffline);
    window.addEventListener('ap:api-online', onApiOnline);
    window.addEventListener('ap:api-offline', onApiOffline);
    window.addEventListener('ap:api-stale-data', onStaleData);

    Network.getStatus().then(apply).catch(() => { /* browser fallback above */ });
    const listener = Network.addListener('networkStatusChange', apply).catch(() => null);

    return () => {
      mounted = false;
      window.removeEventListener('online', onBrowserOnline);
      window.removeEventListener('offline', onBrowserOffline);
      window.removeEventListener('ap:api-online', onApiOnline);
      window.removeEventListener('ap:api-offline', onApiOffline);
      window.removeEventListener('ap:api-stale-data', onStaleData);
      listener.then((handle) => handle?.remove()).catch(() => {});
    };
  }, []);

  const value = useMemo(() => ({ online, connectionType, staleData }), [online, connectionType, staleData]);
  return <NetworkCtx.Provider value={value}>{children}</NetworkCtx.Provider>;
}
