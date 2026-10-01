import {
  clearSessionTokens,
  getAccessToken,
  getRefreshToken,
  initSecureSession,
  isNativeRuntime,
  setSessionTokens,
} from '../lib/secureStorage';

export class ApiError extends Error {
  status: number;
  details?: any;
  constructor(status: number, message: string, details?: any) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
  }
}

const API_ORIGIN_KEY = 'ami_pharma_api_origin_v1';
const CACHE_PREFIX = 'ami_pharma_api_cache_v1:';
const DEFAULT_NATIVE_API = 'http://10.0.2.2:4000';
const REQUEST_TIMEOUT_MS = 30_000;

let refreshPromise: Promise<string | null> | null = null;

function safeLocalStorageGet(key: string): string | null {
  try { return typeof window !== 'undefined' ? window.localStorage.getItem(key) : null; } catch { return null; }
}

function safeLocalStorageSet(key: string, value: string): void {
  try { if (typeof window !== 'undefined') window.localStorage.setItem(key, value); } catch { /* storage quota/private mode */ }
}

function safeLocalStorageRemove(key: string): void {
  try { if (typeof window !== 'undefined') window.localStorage.removeItem(key); } catch { /* ignore */ }
}

/** Normalize a user/build-time API origin and prevent accidental /api/api URLs. */
export function normalizeApiOrigin(value: string | undefined | null): string {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    let pathname = url.pathname.replace(/\/+$/, '');
    if (pathname.toLowerCase().endsWith('/api')) pathname = pathname.slice(0, -4);
    return `${url.origin}${pathname}`.replace(/\/$/, '');
  } catch {
    return '';
  }
}

const buildTimeOrigin = normalizeApiOrigin(import.meta.env.VITE_API_URL);

export function isNativeApp(): boolean {
  // Capacitor is the normal Android runtime. The marker is only used by the
  // constrained fallback APK built in this sandbox; it still exposes the same
  // mobile API contract without changing the browser build.
  return isNativeRuntime();
}

/**
 * The web build keeps the original same-origin /api contract. The Android
 * build uses VITE_API_URL when supplied, or the Android emulator host by
 * default. A physical device can set the HTTPS endpoint from the login screen.
 */
export function getApiOrigin(): string {
  const saved = normalizeApiOrigin(safeLocalStorageGet(API_ORIGIN_KEY));
  if (saved) return saved;
  if (buildTimeOrigin) return buildTimeOrigin;
  return isNativeApp() ? DEFAULT_NATIVE_API : '';
}

export function setApiOrigin(value: string): string {
  const normalized = normalizeApiOrigin(value);
  if (!normalized) throw new ApiError(400, 'URL du serveur invalide. Utilisez http:// ou https://.');
  safeLocalStorageSet(API_ORIGIN_KEY, normalized);
  dispatchApiEvent('ap:api-origin-changed', { origin: normalized });
  return normalized;
}

export function resetApiOrigin(): void {
  safeLocalStorageRemove(API_ORIGIN_KEY);
  dispatchApiEvent('ap:api-origin-changed', { origin: getApiOrigin() });
}

export function apiUrl(pathOrUrl: string): string {
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  const path = pathOrUrl.startsWith('/') ? pathOrUrl : `/${pathOrUrl}`;
  const origin = getApiOrigin();
  return `${origin}${path}`;
}

export async function initApiSession(): Promise<void> {
  await initSecureSession();
  // A browser deliberately has no token in JavaScript after a reload. Restore
  // the in-memory access token through the server's httpOnly cookie instead of
  // declaring the user logged out before trying the refresh endpoint.
  // When the transport is offline, do not wait for a refresh request that
  // cannot succeed. AuthContext can restore the cached non-secret profile and
  // keep the local business database usable until the API returns.
  if (!getAccessToken() && (typeof navigator === 'undefined' || navigator.onLine !== false)) await tryRefresh();
}

export function getToken(): string | null {
  return getAccessToken();
}

/** Kept for existing callers; token material is persisted in secure storage. */
export async function setToken(token: string | null): Promise<void> {
  await setSessionTokens(token);
}

function dispatchApiEvent(name: string, detail?: Record<string, unknown>): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(name, { detail }));
}

function isCacheableGet(url: string): boolean {
  // Core business records are served from IndexedDB when offline. Keep the
  // legacy string cache only for read-only dashboard/report presentation;
  // never let it replace a durable product, price, stock or invoice record.
  return /\/api\/(dashboard|rapports|settings)(?:[/?]|$)/.test(url);
}

function cacheKey(url: string): string {
  return `${CACHE_PREFIX}${url}`;
}

function cacheResponse(url: string, value: unknown): void {
  if (!isCacheableGet(url) || typeof window === 'undefined') return;
  try {
    const encoded = JSON.stringify({ cachedAt: Date.now(), value });
    // Avoid filling browser/WebView storage with the full 2,826-item catalogue.
    if (encoded.length <= 350_000) safeLocalStorageSet(cacheKey(url), encoded);
  } catch { /* cache is an optional enhancement */ }
}

function readCachedResponse(url: string): unknown | undefined {
  if (!isCacheableGet(url) || typeof window === 'undefined') return undefined;
  try {
    const raw = window.localStorage.getItem(cacheKey(url));
    if (!raw) return undefined;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !('value' in parsed)) return undefined;
    return parsed.value;
  } catch { return undefined; }
}

export function clearApiCache(): void {
  if (typeof window === 'undefined') return;
  const keys: string[] = [];
  for (let i = 0; i < window.localStorage.length; i += 1) {
    const key = window.localStorage.key(i);
    if (key?.startsWith(CACHE_PREFIX)) keys.push(key);
  }
  keys.forEach((key) => window.localStorage.removeItem(key));
}

function networkError(url: string, cause?: unknown): ApiError {
  dispatchApiEvent('ap:api-offline', { url });
  if (cause instanceof DOMException && cause.name === 'AbortError') {
    return new ApiError(0, 'Le serveur met trop de temps à répondre. Vérifiez la connexion puis réessayez.');
  }
  return new ApiError(0, 'Service backend injoignable. Vérifiez la connexion Internet et l’URL du serveur, puis réessayez.');
}

async function tryRefresh(): Promise<string | null> {
  if (!refreshPromise) {
    refreshPromise = (async () => {
      const refreshToken = getRefreshToken();
      const headers: Record<string, string> = { Accept: 'application/json' };
      const body = refreshToken ? JSON.stringify({ refreshToken }) : undefined;
      if (body) headers['Content-Type'] = 'application/json';
      if (isNativeApp()) headers['X-Client-Platform'] = 'android';

      try {
        const response = await fetch(apiUrl('/api/auth/refresh'), {
          method: 'POST', headers, credentials: 'include', body,
        });
        if (!response.ok) return null;
        const data = await response.json();
        await setSessionTokens(data.accessToken, data.refreshToken);
        return data.accessToken as string;
      } catch {
        return null;
      }
    })().finally(() => { refreshPromise = null; });
  }
  return refreshPromise;
}

async function request(method: string, path: string, body?: any, retry = true): Promise<any> {
  await initSecureSession();
  const target = apiUrl(path);
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const token = getAccessToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (isNativeApp()) headers['X-Client-Platform'] = 'android';

  if (!navigator.onLine && method !== 'GET') {
    throw new ApiError(0, 'Vous êtes hors connexion. Cette opération nécessite une connexion au serveur.');
  }

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(target, {
      method, headers, credentials: 'include',
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch (error) {
    window.clearTimeout(timeout);
    if (method === 'GET') {
      const cached = readCachedResponse(target);
      if (cached !== undefined) {
        dispatchApiEvent('ap:api-stale-data', { url: target });
        return cached;
      }
    }
    throw networkError(target, error);
  }
  window.clearTimeout(timeout);
  dispatchApiEvent('ap:api-online', { url: target });

  if (response.status === 401 && retry && !/\/auth\/(login|refresh)$/.test(path)) {
    const nextToken = await tryRefresh();
    if (nextToken) return request(method, path, body, false);
    await clearSessionTokens();
    dispatchApiEvent('ap:logout');
    throw new ApiError(401, 'Session expirée, veuillez vous reconnecter.');
  }

  if (!response.ok) {
    let message = `Erreur ${response.status}`;
    let details: any;
    try {
      const data = await response.json();
      message = data.error || message;
      details = data.details;
    } catch { /* non-JSON response */ }
    if ([502, 503, 504].includes(response.status)) {
      message = message.startsWith('Service backend')
        ? message
        : `Service backend momentanément injoignable (HTTP ${response.status}). Réessayez dans quelques secondes.`;
    }
    throw new ApiError(response.status, message, details);
  }
  if (response.status === 204) return null;
  const contentType = response.headers.get('content-type') || '';
  const result = contentType.includes('application/json') ? await response.json() : await response.text();
  if (method === 'GET' && contentType.includes('application/json')) cacheResponse(target, result);
  return result;
}

export const api = {
  get: (url: string) => request('GET', url),
  post: (url: string, body?: any) => request('POST', url, body ?? {}),
  put: (url: string, body?: any) => request('PUT', url, body ?? {}),
  del: (url: string) => request('DELETE', url),
};

// Téléchargement d'un export authentifié (xlsx / pdf / csv).
export async function downloadExport(url: string, filename: string): Promise<void> {
  await initSecureSession();
  const headers: Record<string, string> = { Accept: '*/*' };
  const token = getAccessToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (isNativeApp()) headers['X-Client-Platform'] = 'android';
  let response: Response;
  try {
    response = await fetch(apiUrl(url), { headers, credentials: 'include' });
  } catch (error) {
    throw networkError(url, error);
  }
  if (!response.ok) throw new ApiError(response.status, 'Échec du téléchargement');
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = filename;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}
