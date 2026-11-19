import { REFRESH_SECONDS, SETTINGS_KEY } from './settings.ts';

// Each test gets a fresh module so the store's in-memory copy starts empty.
async function loadStore() {
  vi.resetModules();
  return import('./settings.ts');
}

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('settings store', () => {
  it('starts from the defaults when nothing is stored', async () => {
    const store = await loadStore();
    expect(store.getSettings()).toEqual({
      theme: 'system',
      refreshSeconds: 5,
      notifyChanges: true,
      showRevision: true,
    });
  });

  it('updates one or more fields and keeps the rest', async () => {
    const store = await loadStore();
    store.updateSettings({ theme: 'dark' });
    store.updateSettings({ refreshSeconds: 60, notifyChanges: false });
    expect(store.getSettings()).toEqual({
      theme: 'dark',
      refreshSeconds: 60,
      notifyChanges: false,
      showRevision: true,
    });
  });

  it('notifies subscribers on change and stops after unsubscribe', async () => {
    const store = await loadStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribeSettings(listener);
    store.updateSettings({ showRevision: false });
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    store.updateSettings({ showRevision: true });
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
    expect(second.getSettings()).toMatchObject({ theme: 'dark', refreshSeconds: 15 });
  });

  it('falls back to the defaults for corrupt JSON', async () => {
    localStorage.setItem(SETTINGS_KEY, '{not json');
    const store = await loadStore();
    expect(store.getSettings().theme).toBe('system');
    expect(store.getSettings().refreshSeconds).toBe(5);
  });

  it('falls back to the defaults for a stored value that is not an object', async () => {
    localStorage.setItem(SETTINGS_KEY, '"dark"');
    const store = await loadStore();
    expect(store.getSettings().theme).toBe('system');
  });

  it('keeps valid fields of a partly corrupt stored object and defaults the others', async () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ theme: 'neon', showRevision: false }));
    const store = await loadStore();
    expect(store.getSettings()).toMatchObject({ theme: 'system', showRevision: false });
  });

  it('replaces invalid values with the default on read and on update', async () => {
    localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({ theme: 'neon', refreshSeconds: 7, notifyChanges: 'yes', showRevision: 0 }),
    );
    const store = await loadStore();
    expect(store.getSettings()).toEqual({
      theme: 'system',
      refreshSeconds: 5,
      notifyChanges: true,
      showRevision: true,
    });
    store.updateSettings({ theme: 'sepia' as never, refreshSeconds: 90 as never });
    expect(store.getSettings()).toMatchObject({ theme: 'system', refreshSeconds: 5 });
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
    expect(store.getSettings().theme).toBe('system');
    store.updateSettings({ theme: 'dark' });
    expect(store.getSettings().theme).toBe('dark');
  });

  it('keeps an update in memory when only writing storage throws', async () => {
    const store = await loadStore();
    store.updateSettings({ notifyChanges: false });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    store.updateSettings({ theme: 'light' });
    expect(store.getSettings()).toMatchObject({ theme: 'light', notifyChanges: false });
  });

  it('resets to the defaults', async () => {
    const store = await loadStore();
    store.updateSettings({ theme: 'dark', refreshSeconds: 0, notifyChanges: false, showRevision: false });
    store.resetSettings();
    expect(store.getSettings()).toEqual({
      theme: 'system',
      refreshSeconds: 5,
      notifyChanges: true,
      showRevision: true,
    });
    expect(JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}')).toMatchObject({ theme: 'system' });
  });

  it('gives the same object until a setting changes, so React does not re-render needlessly', async () => {
    const store = await loadStore();
    const first = store.getSettings();
    expect(store.getSettings()).toBe(first);
    store.updateSettings({ showRevision: false });
    expect(store.getSettings()).not.toBe(first);
  });
});
