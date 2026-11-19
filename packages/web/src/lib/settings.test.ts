import { REFRESH_SECONDS, SETTINGS_KEY } from './settings.ts';

const LEGACY_THEME_KEY = 'adrien-theme';

// Each test gets a fresh module so the store's in-memory copy starts empty.
async function loadStore() {
  vi.resetModules();
  return import('./settings.ts');
}

const DEFAULTS = { theme: 'system', refreshSeconds: 5 };

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('settings store', () => {
  it('starts from the defaults when nothing is stored', async () => {
    const store = await loadStore();
    expect(store.getSettings()).toEqual(DEFAULTS);
  });

  it('updates one or more fields and keeps the rest', async () => {
    const store = await loadStore();
    store.updateSettings({ theme: 'dark' });
    store.updateSettings({ refreshSeconds: 60 });
    expect(store.getSettings()).toEqual({ theme: 'dark', refreshSeconds: 60 });
  });

  it('notifies subscribers on change and stops after unsubscribe', async () => {
    const store = await loadStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribeSettings(listener);
    store.updateSettings({ theme: 'light' });
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    store.updateSettings({ theme: 'dark' });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('persists the settings under one key', async () => {
    const store = await loadStore();
    store.updateSettings({ theme: 'light' });
    expect(SETTINGS_KEY).toBe('adrien.settings');
    expect(JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}')).toMatchObject({ theme: 'light' });
  });

  it('reads back what was stored, after a fresh load', async () => {
    const first = await loadStore();
    first.updateSettings({ theme: 'dark', refreshSeconds: 15 });
    const second = await loadStore();
    expect(second.getSettings()).toEqual({ theme: 'dark', refreshSeconds: 15 });
  });

  it('falls back to the defaults for corrupt JSON', async () => {
    localStorage.setItem(SETTINGS_KEY, '{not json');
    const store = await loadStore();
    expect(store.getSettings()).toEqual(DEFAULTS);
  });

  it('falls back to the defaults for a stored value that is not an object', async () => {
    localStorage.setItem(SETTINGS_KEY, '"dark"');
    const store = await loadStore();
    expect(store.getSettings()).toEqual(DEFAULTS);
  });

  it('keeps the valid fields of a partly corrupt stored object and defaults the others', async () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ theme: 'neon', refreshSeconds: 15 }));
    const store = await loadStore();
    expect(store.getSettings()).toEqual({ theme: 'system', refreshSeconds: 15 });
  });

  it('replaces an invalid stored value with the default on read', async () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ theme: 'neon', refreshSeconds: 7 }));
    const store = await loadStore();
    expect(store.getSettings()).toEqual(DEFAULTS);
  });

  it('keeps the current value when an update carries an invalid one', async () => {
    const store = await loadStore();
    store.updateSettings({ theme: 'dark', refreshSeconds: 60 });
    store.updateSettings({ theme: 'sepia' as never, refreshSeconds: 90 as never });
    expect(store.getSettings()).toEqual({ theme: 'dark', refreshSeconds: 60 });
  });

  it('accepts every refresh interval, including 0 for off', async () => {
    const store = await loadStore();
    for (const seconds of REFRESH_SECONDS) {
      store.updateSettings({ refreshSeconds: seconds });
      expect(store.getSettings().refreshSeconds).toBe(seconds);
    }
  });

  it('keeps the settings in memory when reading storage throws', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const store = await loadStore();
    expect(store.getSettings()).toEqual(DEFAULTS);
    store.updateSettings({ theme: 'dark' });
    expect(store.getSettings().theme).toBe('dark');
  });

  it('keeps an update in memory when only writing storage throws', async () => {
    const store = await loadStore();
    store.updateSettings({ refreshSeconds: 30 });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    store.updateSettings({ theme: 'light' });
    expect(store.getSettings()).toEqual({ theme: 'light', refreshSeconds: 30 });
  });

  it('keeps unknown stored keys when it writes', async () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ theme: 'light', future: { x: 1 } }));
    const store = await loadStore();
    store.updateSettings({ refreshSeconds: 15 });
    expect(JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}')).toEqual({
      theme: 'light',
      refreshSeconds: 15,
      future: { x: 1 },
    });
  });

  it('resets to the defaults', async () => {
    const store = await loadStore();
    store.updateSettings({ theme: 'dark', refreshSeconds: 0 });
    store.resetSettings();
    expect(store.getSettings()).toEqual(DEFAULTS);
    expect(JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}')).toMatchObject(DEFAULTS);
  });

  it('gives the same object until a setting changes, so React does not re-render needlessly', async () => {
    const store = await loadStore();
    const first = store.getSettings();
    expect(store.getSettings()).toBe(first);
    store.updateSettings({ refreshSeconds: 0 });
    expect(store.getSettings()).not.toBe(first);
  });

  it('seeds the settings from the old theme key once, then removes that key', async () => {
    localStorage.setItem(LEGACY_THEME_KEY, 'dark');
    const store = await loadStore();
    expect(store.getSettings().theme).toBe('dark');
    expect(JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}')).toMatchObject({ theme: 'dark' });
    expect(localStorage.getItem(LEGACY_THEME_KEY)).toBeNull();
  });

  it('ignores the old theme key when the settings are already stored', async () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ theme: 'light' }));
    localStorage.setItem(LEGACY_THEME_KEY, 'dark');
    const store = await loadStore();
    expect(store.getSettings().theme).toBe('light');
    expect(localStorage.getItem(LEGACY_THEME_KEY)).toBe('dark');
  });

  it('does not seed from an old theme key that is not light or dark', async () => {
    localStorage.setItem(LEGACY_THEME_KEY, 'neon');
    const store = await loadStore();
    expect(store.getSettings()).toEqual(DEFAULTS);
  });

  it('keeps the seeded theme in memory when storage cannot be written', async () => {
    localStorage.setItem(LEGACY_THEME_KEY, 'light');
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const store = await loadStore();
    expect(store.getSettings().theme).toBe('light');
  });

  it('applies a change made in another tab and notifies subscribers', async () => {
    const store = await loadStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribeSettings(listener);
    expect(store.getSettings().theme).toBe('system');

    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ theme: 'dark', refreshSeconds: 5 }));
    window.dispatchEvent(new StorageEvent('storage', { key: SETTINGS_KEY }));

    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.getSettings().theme).toBe('dark');
    unsubscribe();
  });

  it('also reacts to a storage event that clears every key', async () => {
    const store = await loadStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribeSettings(listener);
    window.dispatchEvent(new StorageEvent('storage', { key: null }));
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it('ignores storage events for other keys and after unsubscribing', async () => {
    const store = await loadStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribeSettings(listener);
    window.dispatchEvent(new StorageEvent('storage', { key: 'something-else' }));
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
    window.dispatchEvent(new StorageEvent('storage', { key: SETTINGS_KEY }));
    expect(listener).not.toHaveBeenCalled();
  });
});
