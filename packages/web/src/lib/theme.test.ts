import { act, renderHook } from '@testing-library/react';
import { getSettings, SETTINGS_KEY, updateSettings } from './settings.ts';
import { applyTheme, initialTheme, resolveTheme, useApplyTheme, useTheme } from './theme.ts';

/** A matchMedia whose preference the test can change; listeners are real, as in a browser. */
function mockSystemTheme(dark: boolean) {
  const listeners = new Set<() => void>();
  let isDark = dark;
  vi.stubGlobal('matchMedia', (query: string) => ({
    get matches() {
      return isDark && query.includes('dark');
    },
    media: query,
    addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
  }));
  return {
    /** Changes the system preference and fires the change listeners, as the OS would. */
    set(next: boolean) {
      isDark = next;
      for (const listener of listeners) listener();
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
  document.documentElement.className = '';
});

describe('theme', () => {
  it('follows prefers-color-scheme when nothing is stored', () => {
    mockSystemTheme(true);
    expect(initialTheme()).toBe('dark');
    mockSystemTheme(false);
    expect(initialTheme()).toBe('light');
  });

  it('prefers the stored choice', () => {
    mockSystemTheme(true);
    updateSettings({ theme: 'light' });
    expect(initialTheme()).toBe('light');
  });

  it('ignores a corrupt stored value', () => {
    mockSystemTheme(false);
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

  it('stores a choice made through the toggle hook in the shared settings', () => {
    mockSystemTheme(false);
    const { result } = renderHook(() => useTheme());
    act(() => result.current[1]('dark'));
    expect(getSettings().theme).toBe('dark');
    expect(result.current[0]).toBe('dark');
  });

  it('follows a live change of the system preference while the setting is system', () => {
    const system = mockSystemTheme(false);
    const { result } = renderHook(() => useTheme());
    expect(result.current[0]).toBe('light');
    act(() => system.set(true));
    expect(result.current[0]).toBe('dark');
  });

  it('ignores a live change of the system preference when a theme is chosen', () => {
    const system = mockSystemTheme(false);
    const { result } = renderHook(() => useTheme());
    act(() => result.current[1]('light'));
    act(() => system.set(true));
    expect(result.current[0]).toBe('light');
  });

  it('applies the stored theme to <html> from the app-level hook, and follows the system live', () => {
    const system = mockSystemTheme(false);
    renderHook(() => useApplyTheme());
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    act(() => system.set(true));
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('applies a setting that changes, whoever changed it', () => {
    mockSystemTheme(false);
    renderHook(() => useApplyTheme());
    act(() => updateSettings({ theme: 'dark' }));
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });
});
