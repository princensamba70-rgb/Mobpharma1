import { SecureStoragePlugin } from 'capacitor-secure-storage-plugin';

// The access and refresh tokens never use ordinary localStorage. On Android the
// plugin uses Android Keystore-backed encryption; the web implementation is only
// a browser fallback because browsers do not expose a hardware keystore.
const ACCESS_TOKEN_KEY = 'ami_pharma_access_token_v1';
const REFRESH_TOKEN_KEY = 'ami_pharma_refresh_token_v1';

let accessToken: string | null = null;
let refreshToken: string | null = null;
let initialized = false;
let initPromise: Promise<void> | null = null;

function fallbackKeystoreBridge(): Window['AmiPharmaSecureStorage'] | undefined {
  if (typeof window === 'undefined') return undefined;
  return window.AmiPharmaSecureStorage;
}

async function read(key: string): Promise<string | null> {
  const bridge = fallbackKeystoreBridge();
  if (bridge) {
    try { return bridge.get(key) || null; } catch { return null; }
  }
  try {
    const result = await SecureStoragePlugin.get({ key });
    return result?.value || null;
  } catch {
    // Missing values are reported as a rejected promise by the plugin.
    return null;
  }
}

async function write(key: string, value: string | null): Promise<void> {
  const bridge = fallbackKeystoreBridge();
  if (bridge) {
    const ok = value ? bridge.set(key, value) : bridge.remove(key);
    if (value && !ok) throw new Error('Le stockage sécurisé des identifiants est indisponible.');
    return;
  }
  try {
    if (value) await SecureStoragePlugin.set({ key, value });
    else await SecureStoragePlugin.remove({ key });
  } catch {
    // Do not silently write secrets to localStorage. A native build without the
    // plugin must fail closed rather than downgrade token storage security.
    if (value) throw new Error('Le stockage sécurisé des identifiants est indisponible.');
  }
}

export async function initSecureSession(): Promise<void> {
  if (initialized) return;
  if (!initPromise) {
    initPromise = (async () => {
      accessToken = await read(ACCESS_TOKEN_KEY);
      refreshToken = await read(REFRESH_TOKEN_KEY);

      // One-time migration from the old web-only token key. It is removed after
      // migration and is never used as the normal storage mechanism again.
      if (!accessToken && typeof window !== 'undefined') {
        const legacyToken = window.localStorage.getItem('ap_token');
        if (legacyToken) {
          try {
            await write(ACCESS_TOKEN_KEY, legacyToken);
            accessToken = legacyToken;
            window.localStorage.removeItem('ap_token');
          } catch {
            // Keep the session logged out if secure storage cannot be used.
            accessToken = null;
          }
        }
      }
      initialized = true;
    })().finally(() => {
      initPromise = null;
    });
  }
  await initPromise;
}

export function getAccessToken(): string | null {
  return accessToken;
}

export function getRefreshToken(): string | null {
  return refreshToken;
}

export async function setSessionTokens(nextAccess: string | null, nextRefresh?: string | null): Promise<void> {
  await initSecureSession();
  await write(ACCESS_TOKEN_KEY, nextAccess);
  accessToken = nextAccess;
  if (nextRefresh !== undefined) {
    await write(REFRESH_TOKEN_KEY, nextRefresh);
    refreshToken = nextRefresh;
  }
}

export async function clearSessionTokens(): Promise<void> {
  await initSecureSession();
  await Promise.all([
    write(ACCESS_TOKEN_KEY, null),
    write(REFRESH_TOKEN_KEY, null),
  ]);
  accessToken = null;
  refreshToken = null;
}
