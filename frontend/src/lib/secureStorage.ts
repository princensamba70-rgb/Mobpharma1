import { Capacitor, registerPlugin } from '@capacitor/core';

interface NativeSecureStoragePlugin {
  isAvailable: () => Promise<{ value: boolean }>;
  get: (options: { key: string }) => Promise<{ value: string }>;
  set: (options: { key: string; value: string }) => Promise<{ value: boolean }>;
  remove: (options: { key: string }) => Promise<{ value: boolean }>;
}

const NativeSecureStorage = registerPlugin<NativeSecureStoragePlugin>('AmiPharmaSecureStorage');

const ACCESS_TOKEN_KEY = 'ami_pharma_access_token_v1';
const REFRESH_TOKEN_KEY = 'ami_pharma_refresh_token_v1';
const LEGACY_TOKEN_KEY = 'ap_token';
const WEB_PLUGIN_PREFIX = 'cap_sec_';

/**
 * A browser does not have an application Keystore. The browser path therefore
 * deliberately uses the server's httpOnly refresh cookie and keeps the access
 * token in memory only. It must not use the plugin's web implementation: that
 * implementation is only base64 around localStorage, not secure storage.
 */
export type SessionStorageMode = 'secure' | 'httpOnly-cookie' | 'memory';

export interface SessionStorageStatus {
  mode: SessionStorageMode;
  persistent: boolean;
  warning?: string;
}

const MEMORY_SESSION_WARNING =
  'Le stockage sécurisé est indisponible. La session reste active uniquement en mémoire sur cet appareil ; reconnectez-vous après le redémarrage de l’application.';

let accessToken: string | null = null;
let refreshToken: string | null = null;
let initialized = false;
let initPromise: Promise<void> | null = null;
let sessionStatus: SessionStorageStatus = {
  mode: 'memory',
  persistent: false,
  warning: MEMORY_SESSION_WARNING,
};

function browserWindow(): Window | undefined {
  return typeof window === 'undefined' ? undefined : window;
}

/** Capacitor Android or the constrained fallback APK, never a normal browser. */
export function isNativeRuntime(): boolean {
  const currentWindow = browserWindow();
  return Capacitor.isNativePlatform()
    || currentWindow?.__AMI_ANDROID__ === true
    || Boolean(currentWindow?.AmiPharmaSecureStorage);
}

function setStatus(mode: SessionStorageMode, warning?: string): SessionStorageStatus {
  sessionStatus = {
    mode,
    persistent: mode !== 'memory',
    ...(warning ? { warning } : {}),
  };
  return getSessionStorageStatus();
}

export function getSessionStorageStatus(): SessionStorageStatus {
  return { ...sessionStatus };
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error || '');
}

function isMissingValueError(error: unknown): boolean {
  return /item.*(does not exist|does not exist|not found)|missing|given key/i.test(errorText(error));
}

function removeLegacyBrowserSecrets(): void {
  const currentWindow = browserWindow();
  if (!currentWindow) return;
  // These keys belong to older builds. They are removed, never read as a
  // fallback, so a browser cannot keep bearer tokens in ordinary storage.
  try {
    currentWindow.localStorage.removeItem(LEGACY_TOKEN_KEY);
    currentWindow.localStorage.removeItem(`${WEB_PLUGIN_PREFIX}${ACCESS_TOKEN_KEY}`);
    currentWindow.localStorage.removeItem(`${WEB_PLUGIN_PREFIX}${REFRESH_TOKEN_KEY}`);
  } catch {
    // A blocked localStorage does not affect the in-memory/cookie strategy.
  }
}

interface SecureReadResult {
  available: boolean;
  value: string | null;
}

function fallbackBridge(): Window['AmiPharmaSecureStorage'] | undefined {
  return browserWindow()?.AmiPharmaSecureStorage;
}

async function readNative(key: string): Promise<SecureReadResult> {
  const bridge = fallbackBridge();
  if (bridge) {
    try {
      if (bridge.isAvailable && !bridge.isAvailable()) return { available: false, value: null };
      return { available: true, value: bridge.get(key) || null };
    } catch {
      return { available: false, value: null };
    }
  }

  try {
    const capability = await NativeSecureStorage.isAvailable();
    if (!capability?.value) return { available: false, value: null };
  } catch {
    return { available: false, value: null };
  }

  try {
    const result = await NativeSecureStorage.get({ key });
    return { available: true, value: result?.value || null };
  } catch (error) {
    // The native plugin rejects when a key is absent. That is a healthy empty
    // store, unlike a missing plugin, a broken bridge, or a broken Keystore.
    return isMissingValueError(error)
      ? { available: true, value: null }
      : { available: false, value: null };
  }
}

async function writeNative(key: string, value: string | null): Promise<void> {
  const bridge = fallbackBridge();
  if (bridge) {
    if (bridge.isAvailable && !bridge.isAvailable()) throw new Error('secure storage unavailable');
    const ok = value === null ? bridge.remove(key) : bridge.set(key, value);
    if (!ok) throw new Error('secure storage unavailable');
    return;
  }

  const capability = await NativeSecureStorage.isAvailable();
  if (!capability?.value) throw new Error('secure storage unavailable');
  if (value === null) {
    try {
      await NativeSecureStorage.remove({ key });
    } catch (error) {
      if (!isMissingValueError(error)) throw error;
    }
    return;
  }
  const result = await NativeSecureStorage.set({ key, value });
  if (result?.value === false) throw new Error('secure storage unavailable');
}

async function clearNativeBestEffort(): Promise<boolean> {
  const results = await Promise.allSettled([
    writeNative(ACCESS_TOKEN_KEY, null),
    writeNative(REFRESH_TOKEN_KEY, null),
  ]);
  return results.every((result) => result.status === 'fulfilled');
}

export async function initSecureSession(): Promise<void> {
  if (initialized) return;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    if (!isNativeRuntime()) {
      removeLegacyBrowserSecrets();
      accessToken = null;
      refreshToken = null;
      setStatus('httpOnly-cookie');
      initialized = true;
      return;
    }

    const [access, refresh] = await Promise.all([
      readNative(ACCESS_TOKEN_KEY),
      readNative(REFRESH_TOKEN_KEY),
    ]);

    if (!access.available || !refresh.available) {
      // Do not use an old localStorage token when the Keystore is unavailable.
      // Losing persistence is safer than silently downgrading bearer-token
      // storage to an unencrypted WebView store.
      removeLegacyBrowserSecrets();
      accessToken = null;
      refreshToken = null;
      setStatus('memory', MEMORY_SESSION_WARNING);
      initialized = true;
      return;
    }

    accessToken = access.value;
    refreshToken = refresh.value;
    setStatus('secure');

    // Migrate only when the secure backend has already proved available. The
    // legacy value is never retained if that migration fails.
    const currentWindow = browserWindow();
    let legacyToken: string | null = null;
    try { legacyToken = currentWindow?.localStorage.getItem(LEGACY_TOKEN_KEY) || null; } catch { legacyToken = null; }
    if (!accessToken && legacyToken) {
      try {
        await writeNative(ACCESS_TOKEN_KEY, legacyToken);
        accessToken = legacyToken;
        try { currentWindow?.localStorage.removeItem(LEGACY_TOKEN_KEY); } catch { /* cleanup only */ }
      } catch {
        try { currentWindow?.localStorage.removeItem(LEGACY_TOKEN_KEY); } catch { /* cleanup only */ }
      }
    } else {
      try { currentWindow?.localStorage.removeItem(LEGACY_TOKEN_KEY); } catch { /* cleanup only */ }
    }
    initialized = true;
  })().catch(() => {
    // The adapter itself must not prevent the app from starting. The caller
    // receives a deliberately non-persistent memory session instead.
    accessToken = null;
    refreshToken = null;
    setStatus('memory', MEMORY_SESSION_WARNING);
    initialized = true;
  }).finally(() => {
    initPromise = null;
  });

  await initPromise;
}

export function getAccessToken(): string | null {
  return accessToken;
}

export function getRefreshToken(): string | null {
  return refreshToken;
}

/**
 * Store a session without making persistence a prerequisite for authentication.
 * In a browser, only the server cookie is persistent; in a native memory
 * fallback, both bearer tokens exist only for the current process.
 */
export async function setSessionTokens(nextAccess: string | null, nextRefresh?: string | null): Promise<SessionStorageStatus> {
  await initSecureSession();

  if (!isNativeRuntime() || sessionStatus.mode === 'httpOnly-cookie') {
    accessToken = nextAccess;
    // Never copy a refresh token into browser JavaScript when the httpOnly
    // cookie is the supported persistence mechanism.
    refreshToken = null;
    return getSessionStorageStatus();
  }

  const resultingRefresh = nextRefresh === undefined ? refreshToken : nextRefresh;
  if (sessionStatus.mode === 'secure') {
    try {
      await writeNative(ACCESS_TOKEN_KEY, nextAccess);
      if (nextRefresh !== undefined) await writeNative(REFRESH_TOKEN_KEY, resultingRefresh);
      accessToken = nextAccess;
      refreshToken = resultingRefresh;
      return getSessionStorageStatus();
    } catch {
      // A failed secure write is a capability loss, not an authentication
      // failure. Remove any partial write and continue with memory only.
      await clearNativeBestEffort();
      accessToken = nextAccess;
      refreshToken = resultingRefresh;
      setStatus('memory', MEMORY_SESSION_WARNING);
      return getSessionStorageStatus();
    }
  }

  accessToken = nextAccess;
  refreshToken = resultingRefresh;
  return getSessionStorageStatus();
}

export async function clearSessionTokens(): Promise<SessionStorageStatus> {
  await initSecureSession();
  if (sessionStatus.mode === 'secure') {
    if (!(await clearNativeBestEffort())) setStatus('memory', MEMORY_SESSION_WARNING);
  }
  accessToken = null;
  refreshToken = null;
  return getSessionStorageStatus();
}
