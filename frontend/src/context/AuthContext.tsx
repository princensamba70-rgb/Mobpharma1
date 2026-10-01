import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { ApiError, api, clearApiCache, initApiSession, getToken } from '../api/client';
import { setSessionTokens, clearSessionTokens } from '../lib/secureStorage';
import { clearLocalUser, getLocalUser, saveLocalUser, setActiveUserId } from '../lib/offlineDb';

export interface User {
  id: number; nom: string; prenom: string; username: string;
  telephone?: string; email?: string; roleId: 'ADMIN' | 'FINANCE' | 'ASSISTANT';
  roleName: string; actif: boolean;
  permissions: Record<string, 'full' | 'read' | 'none'>;
}

interface AuthCtx {
  user: User | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<User>;
  logout: () => Promise<void>;
  can: (module: string, niveau?: 'full' | 'read') => boolean;
  refreshUser: () => Promise<void>;
}

const Ctx = createContext<AuthCtx>(null as any);
export const useAuth = () => useContext(Ctx);

function dispatchAuthReady(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('ap:auth-ready'));
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshUser = async () => {
    await initApiSession();
    try {
      // Browser sessions use the httpOnly refresh cookie, native sessions use
      // Keystore/memory. The request is still authoritative whenever reachable.
      const data = await api.get('/api/auth/me');
      setUser(data.user);
      await saveLocalUser(data.user).catch(() => {});
      await setActiveUserId(data.user.id).catch(() => {});
      dispatchAuthReady();
    } catch (error) {
      const offline = (error instanceof ApiError && error.status === 0)
        || (typeof navigator !== 'undefined' && navigator.onLine === false);
      if (offline) {
        const cached = await getLocalUser<User>().catch(() => undefined);
        if (cached && cached.actif !== false) {
          setUser(cached);
          await setActiveUserId(cached.id).catch(() => {});
          dispatchAuthReady();
        } else setUser(null);
      } else {
        setUser(null);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void refreshUser(); }, []);
  useEffect(() => {
    const onLogout = () => { setUser(null); };
    window.addEventListener('ap:logout', onLogout);
    return () => window.removeEventListener('ap:logout', onLogout);
  }, []);

  const login = async (username: string, password: string) => {
    const data = await api.post('/api/auth/login', { username, password });
    // Persistence is deliberately best-effort after the server has accepted
    // the credentials. Native uses the Keystore first and falls back to
    // process memory; browsers use the httpOnly refresh cookie and memory.
    await setSessionTokens(data.accessToken, data.refreshToken ?? null);
    setUser(data.user);
    await saveLocalUser(data.user).catch(() => {});
    await setActiveUserId(data.user.id).catch(() => {});
    dispatchAuthReady();
    return data.user as User;
  };

  const logout = async () => {
    try { await api.post('/api/auth/logout'); } catch { /* server may be offline */ }
    await clearSessionTokens();
    clearApiCache();
    await clearLocalUser().catch(() => {});
    await setActiveUserId(null).catch(() => {});
    setUser(null);
  };

  const can = (module: string, niveau: 'full' | 'read' = 'read') => {
    if (!user) return false;
    const permission = user.permissions?.[module] || 'none';
    return niveau === 'read' ? permission !== 'none' : permission === 'full';
  };

  return <Ctx.Provider value={{ user, loading, login, logout, can, refreshUser }}>{children}</Ctx.Provider>;
}
