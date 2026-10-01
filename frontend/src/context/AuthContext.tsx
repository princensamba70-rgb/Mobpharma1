import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { ApiError, api, clearApiCache, initApiSession, AUTH_REQUEST_TIMEOUT_MS } from '../api/client';
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
    // Hydrate the non-secret profile first. A valid local session should make
    // the shell usable immediately while the server verifies the session in
    // the background; the old flow waited for refresh + /me before rendering
    // anything and could leave a dead API behind an apparently infinite
    // loader.
    const cached = await getLocalUser<User>().catch(() => undefined);
    if (cached && cached.actif !== false) {
      setUser(cached);
      await setActiveUserId(cached.id).catch(() => {});
      setLoading(false);
      dispatchAuthReady();
    }

    try {
      // Browser sessions use the httpOnly refresh cookie, native sessions use
      // Keystore/memory. Both boot requests have a short, explicit timeout.
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        throw new ApiError(0, 'Connexion indisponible');
      }
      await initApiSession();
      const data = await api.get('/api/auth/me', { timeoutMs: AUTH_REQUEST_TIMEOUT_MS });
      if (cached && cached.id !== data.user.id) clearApiCache();
      setUser(data.user);
      await saveLocalUser(data.user).catch(() => {});
      await setActiveUserId(data.user.id).catch(() => {});
      dispatchAuthReady();
    } catch (error) {
      const offline = (error instanceof ApiError && error.status === 0)
        || (typeof navigator !== 'undefined' && navigator.onLine === false);
      if (offline) {
        if (!cached || cached.actif === false) setUser(null);
      } else {
        // A definitive 401/invalid session must remove the cached profile;
        // timeouts and transport failures keep it for offline continuity.
        if (!(cached && error instanceof ApiError && error.status === 0)) setUser(null);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void refreshUser(); }, []);
  useEffect(() => {
    const onLogout = () => {
      // Dashboard/report string caches are not business storage and must never
      // survive an account switch or a forced 401 logout.
      clearApiCache();
      setUser(null);
      void clearLocalUser().catch(() => {});
      void setActiveUserId(null);
    };
    window.addEventListener('ap:logout', onLogout);
    return () => window.removeEventListener('ap:logout', onLogout);
  }, []);

  const login = async (username: string, password: string) => {
    const data = await api.post('/api/auth/login', { username, password });
    // Persistence is deliberately best-effort after the server has accepted
    // the credentials. Native uses the Keystore first and falls back to
    // process memory; browsers use the httpOnly refresh cookie and memory.
    await setSessionTokens(data.accessToken, data.refreshToken ?? null);
    clearApiCache();
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
