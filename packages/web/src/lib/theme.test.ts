import { getSettings, SETTINGS_KEY, updateSettings } from './settings.ts';
import { applyTheme, initialTheme, resolveTheme, storeTheme } from './theme.ts';

function mockMatchMedia(dark: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: dark && query.includes('dark'),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
  document.documentElement.className = '';
});

describe('theme', () => {
  it('follows prefers-color-scheme when nothing is stored', () => {
    mockMatchMedia(true);
    expect(initialTheme()).toBe('dark');
    mockMatchMedia(false);
    expect(initialTheme()).toBe('light');
  });

  it('prefers the stored choice', () => {
    mockMatchMedia(true);
    storeTheme('light');
    expect(JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}')).toMatchObject({ theme: 'light' });
    expect(initialTheme()).toBe('light');
  });

  it('stores the choice in the settings, where the Settings page reads it', () => {
    storeTheme('dark');
    expect(getSettings().theme).toBe('dark');
    updateSettings({ theme: 'system' });
    mockMatchMedia(false);
    expect(initialTheme()).toBe('light');
  });

  it('ignores a corrupt stored value', () => {
    mockMatchMedia(false);
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ theme: 'neon' }));
    expect(initialTheme()).toBe('light');
  });

  it('resolves the system setting against the system preference', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });

  it('applies the theme as a class on <html>', () => {
    applyTheme('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    applyTheme('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });
});
