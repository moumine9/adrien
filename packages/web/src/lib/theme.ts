import { useCallback, useEffect, useState } from 'react';
import { getSettings, type ThemeSetting, updateSettings, useSettings } from './settings.ts';

/** The theme in use. The stored setting may also be `system`, which resolves to one of these. */
export type Theme = 'light' | 'dark';

const DARK_QUERY = '(prefers-color-scheme: dark)';

function systemPrefersDark(): boolean {
  return typeof matchMedia === 'function' && matchMedia(DARK_QUERY).matches;
}

/** The theme a setting means: `system` follows the system preference. */
export function resolveTheme(setting: ThemeSetting, systemDark: boolean): Theme {
  if (setting === 'system') return systemDark ? 'dark' : 'light';
  return setting;
}

/** Remembers an explicit light or dark choice in the shared settings. */
export function storeTheme(theme: Theme): void {
  updateSettings({ theme });
}

/** The theme from the stored setting, else the system preference. */
export function initialTheme(): Theme {
  return resolveTheme(getSettings().theme, systemPrefersDark());
}

export function applyTheme(theme: Theme): void {
  document.documentElement.classList.toggle('dark', theme === 'dark');
}

/**
 * The resolved theme and a setter that remembers the choice. The header toggle and the Settings page both read
 * and write the `theme` setting, so they cannot disagree.
 */
export function useTheme(): [Theme, (theme: Theme) => void] {
  const [settings, update] = useSettings();
  const [systemDark, setSystemDark] = useState(systemPrefersDark);

  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const media = matchMedia(DARK_QUERY);
    const onChange = () => setSystemDark(media.matches);
    media.addEventListener?.('change', onChange);
    return () => media.removeEventListener?.('change', onChange);
  }, []);

  const theme = resolveTheme(settings.theme, systemDark);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const setTheme = useCallback((next: Theme) => update({ theme: next }), [update]);

  return [theme, setTheme];
}
