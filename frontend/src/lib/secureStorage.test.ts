import { beforeEach, describe, expect, it, vi } from 'vitest';

const { capacitor, plugin } = vi.hoisted(() => ({
  capacitor: { isNativePlatform: vi.fn(() => false) },
  plugin: {
    isAvailable: vi.fn(),
    get: vi.fn(),
    set: vi.fn(),
    remove: vi.fn(),
  },
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: capacitor,
  registerPlugin: () => plugin,
}));

function makeLocalStorage() {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    key(index: number) { return [...values.keys()][index] ?? null; },
    getItem(key: string) { return values.get(key) ?? null; },
    setItem(key: string, value: string) { values.set(key, value); },
    removeItem(key: string) { values.delete(key); },
    clear() { values.clear(); },
  };
}

async function loadStorage(native: boolean) {
  capacitor.isNativePlatform.mockReturnValue(native);
  vi.resetModules();
  return import('./secureStorage');
}

describe('session credential storage policy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    plugin.isAvailable.mockResolvedValue({ value: true });
    plugin.get.mockRejectedValue(new Error('Item with given key does not exist'));
    plugin.set.mockResolvedValue({ value: true });
    plugin.remove.mockResolvedValue({ value: true });
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { localStorage: makeLocalStorage() },
    });
  });

  it('uses the httpOnly-cookie plus memory strategy in a browser', async () => {
    const storage = await loadStorage(false);
    window.localStorage.setItem('ap_token', 'old-token-must-not-be-used');

    await storage.initSecureSession();
    const status = await storage.setSessionTokens('access', 'refresh-from-response');

    expect(status.mode).toBe('httpOnly-cookie');
    expect(storage.getAccessToken()).toBe('access');
    expect(storage.getRefreshToken()).toBeNull();
    expect(window.localStorage.getItem('ap_token')).toBeNull();
    expect(window.localStorage.getItem('cap_sec_ami_pharma_access_token_v1')).toBeNull();
    expect(plugin.isAvailable).not.toHaveBeenCalled();
  });

  it('persists both tokens when the native secure backend is available', async () => {
    const values = new Map<string, string>();
    plugin.get.mockImplementation(async ({ key }: { key: string }) => {
      if (!values.has(key)) throw new Error('Item with given key does not exist');
      return { value: values.get(key) };
    });
    plugin.set.mockImplementation(async ({ key, value }: { key: string; value: string }) => {
      values.set(key, value);
      return { value: true };
    });
    plugin.remove.mockImplementation(async ({ key }: { key: string }) => {
      values.delete(key);
      return { value: true };
    });

    const storage = await loadStorage(true);
    await storage.initSecureSession();
    const status = await storage.setSessionTokens('access', 'refresh');

    expect(status.mode).toBe('secure');
    expect(status.persistent).toBe(true);
    expect(values.get('ami_pharma_access_token_v1')).toBe('access');
    expect(values.get('ami_pharma_refresh_token_v1')).toBe('refresh');
  });

  it('keeps a native session in memory instead of rejecting a successful login', async () => {
    plugin.isAvailable.mockRejectedValue(new Error('AmiPharmaSecureStorage is unavailable'));

    const storage = await loadStorage(true);
    await storage.initSecureSession();
    const status = await storage.setSessionTokens('access', 'refresh');

    expect(status.mode).toBe('memory');
    expect(status.persistent).toBe(false);
    expect(status.warning).toMatch(/mémoire/i);
    expect(storage.getAccessToken()).toBe('access');
    expect(storage.getRefreshToken()).toBe('refresh');
    await expect(storage.clearSessionTokens()).resolves.toMatchObject({ mode: 'memory' });
    expect(storage.getAccessToken()).toBeNull();
  });
});
