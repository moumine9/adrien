import { useCallback, useEffect, useState } from 'react';
import { getSettings, type ThemeSetting, useSettings } from './settings.ts';

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

/** The theme from the stored setting, else the system preference. */
export function initialTheme(): Theme {
  return resolveTheme(getSettings().theme, systemPrefersDark());
}

export function applyTheme(theme: Theme): void {
  document.documentElement.classList.toggle('dark', theme === 'dark');
}

/** Whether the system currently prefers dark, kept up to date while the page is open. */
function useSystemDark(): boolean {
  const [dark, setDark] = useState(systemPrefersDark);

  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const media = matchMedia(DARK_QUERY);
    const onChange = () => setDark(media.matches);
    onChange();
    media.addEventListener?.('change', onChange);
    return () => media.removeEventListener?.('change', onChange);
  }, []);

  return dark;
}

/** Puts the resolved theme on <html>. Mount it once, at the top of the app. */
export function useApplyTheme(): void {
  const [settings] = useSettings();
  const theme = resolveTheme(settings.theme, useSystemDark());

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);
}

/**
 * The resolved theme and a setter that remembers an explicit choice. The header toggle and the Settings page
 * both write the `theme` setting, so they cannot disagree.
 */
export function useTheme(): [Theme, (theme: Theme) => void] {
  const [settings, update] = useSettings();
  const theme = resolveTheme(settings.theme, useSystemDark());
  const setTheme = useCallback((next: Theme) => update({ theme: next }), [update]);
  return [theme, setTheme];
}
