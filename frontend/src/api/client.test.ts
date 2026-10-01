import { beforeEach, describe, expect, it, vi } from 'vitest';

const session = vi.hoisted(() => ({
  accessToken: null as string | null,
  refreshToken: null as string | null,
}));

vi.mock('../lib/secureStorage', () => ({
  clearSessionTokens: vi.fn(async () => ({ mode: 'httpOnly-cookie', persistent: true })),
  getAccessToken: vi.fn(() => session.accessToken),
  getRefreshToken: vi.fn(() => session.refreshToken),
  initSecureSession: vi.fn(async () => undefined),
  isNativeRuntime: vi.fn(() => false),
  setSessionTokens: vi.fn(async (access: string | null, refresh?: string | null) => {
    session.accessToken = access;
    session.refreshToken = refresh ?? null;
    return { mode: 'httpOnly-cookie', persistent: true };
  }),
}));

function makeLocalStorage() {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    key(index: number) { return [...values.keys()][index] ?? null; },
    getItem(key: string) { return values.get(key) ?? null; },
    setItem(key: string, value: string) { values.set(key, value); },
    removeItem(key: string) { values.delete(key); },
  };
}

const fetchMock = vi.fn();

async function loadClient() {
  vi.resetModules();
  return import('./client');
}

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('API authentication transport', () => {
  beforeEach(() => {
    session.accessToken = null;
    session.refreshToken = null;
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('navigator', { onLine: true });
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        localStorage: makeLocalStorage(),
        setTimeout,
        clearTimeout,
        dispatchEvent: vi.fn(),
      },
    });
  });

  it.each(['http://pharmacy.example', 'https://pharmacy.example'])('sends login to the configured %s origin with cookies enabled', async (origin) => {
    const client = await loadClient();
    client.setApiOrigin(origin);
    fetchMock.mockResolvedValueOnce(jsonResponse({ accessToken: 'access', user: { id: 1 } }));

    await client.api.post('/api/auth/login', { username: 'admin', password: 'not-logged' });

    expect(fetchMock).toHaveBeenCalledWith(`${origin}/api/auth/login`, expect.objectContaining({
      method: 'POST',
      credentials: 'include',
    }));
    expect(fetchMock.mock.calls[0][1].body).toContain('"username":"admin"');
    expect(fetchMock.mock.calls[0][1].body).toContain('"password":"not-logged"');
  });

  it('returns the server authentication error for invalid credentials', async () => {
    const client = await loadClient();
    client.setApiOrigin('https://pharmacy.example');
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'Identifiants incorrects' }, 401));

    await expect(client.api.post('/api/auth/login', { username: 'wrong', password: 'wrong' }))
      .rejects.toMatchObject({ status: 401, message: 'Identifiants incorrects' });
  });

  it('does not bypass an invalid HTTPS certificate or rewrite it to HTTP', async () => {
    const client = await loadClient();
    client.setApiOrigin('https://pharmacy.example');
    fetchMock.mockRejectedValueOnce(new TypeError('certificate verify failed'));

    await expect(client.api.get('/api/health')).rejects.toMatchObject({ status: 0 });
    expect(fetchMock.mock.calls[0][0]).toBe('https://pharmacy.example/api/health');
  });

  it('reports connection loss without inventing an authentication success', async () => {
    const client = await loadClient();
    client.setApiOrigin('http://pharmacy.example');
    fetchMock.mockRejectedValueOnce(new TypeError('network down'));

    await expect(client.api.post('/api/auth/login', { username: 'admin', password: 'secret' }))
      .rejects.toMatchObject({ status: 0 });
    expect(session.accessToken).toBeNull();
  });

  it('cancels a superseded GET without marking the API offline', async () => {
    const client = await loadClient();
    client.setApiOrigin('https://pharmacy.example');
    fetchMock.mockImplementation((_url: string, options: RequestInit) => new Promise((_resolve, reject) => {
      options.signal?.addEventListener('abort', () => reject(new DOMException('cancelled', 'AbortError')));
    }));
    const controller = new AbortController();
    const pending = client.api.get('/api/medicaments/search?q=am', { signal: controller.signal, timeoutMs: 7_000 });
    await Promise.resolve();
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    const events = (window.dispatchEvent as any).mock.calls.map(([event]: [CustomEvent]) => event.type);
    expect(events).not.toContain('ap:api-offline');
  });
});
