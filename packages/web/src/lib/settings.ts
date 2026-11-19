import { useSyncExternalStore } from 'react';

export const SETTINGS_KEY = 'adrien.settings';

export const THEMES = ['system', 'light', 'dark'] as const;
export type ThemeSetting = (typeof THEMES)[number];

/** Seconds between checks for changes; 0 turns checking off. */
export const REFRESH_SECONDS = [0, 5, 15, 30, 60] as const;
export type RefreshSeconds = (typeof REFRESH_SECONDS)[number];

export interface Settings {
  theme: ThemeSetting;
  refreshSeconds: RefreshSeconds;
  notifyChanges: boolean;
  showRevision: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  refreshSeconds: 5,
  notifyChanges: true,
  showRevision: true,
};

/** Keeps a value only if it is one the setting allows; anything else becomes the default. */
function sanitize(value: unknown): Settings {
  const input = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  const { theme, refreshSeconds, notifyChanges, showRevision } = input;
  return {
    theme: THEMES.includes(theme as ThemeSetting) ? (theme as ThemeSetting) : DEFAULT_SETTINGS.theme,
    refreshSeconds: REFRESH_SECONDS.includes(refreshSeconds as RefreshSeconds)
      ? (refreshSeconds as RefreshSeconds)
      : DEFAULT_SETTINGS.refreshSeconds,
    notifyChanges: typeof notifyChanges === 'boolean' ? notifyChanges : DEFAULT_SETTINGS.notifyChanges,
    showRevision: typeof showRevision === 'boolean' ? showRevision : DEFAULT_SETTINGS.showRevision,
  };
}

function parseStored(raw: string | null): Settings {
  if (raw === null) return DEFAULT_SETTINGS;
  try {
    return sanitize(JSON.parse(raw));
  } catch {
    return DEFAULT_SETTINGS;
  }
}

// The last raw string seen in storage and the settings it produced. The object is reused while the
// raw string is unchanged, so useSyncExternalStore sees a stable snapshot. An update that cannot be
// written leaves `lastRaw` alone and becomes the snapshot anyway: the choice then lasts for the page.
let lastRaw: string | null | undefined;
let lastSettings: Settings | undefined;
const listeners = new Set<() => void>();

/** Reads the current settings. Never throws: blocked or corrupt storage yields the defaults or the in-memory copy. */
export function getSettings(): Settings {
  let raw: string | null | undefined;
  try {
    raw = localStorage.getItem(SETTINGS_KEY);
  } catch {
    raw = undefined;
  }
  if (raw === undefined) return lastSettings ?? DEFAULT_SETTINGS;
  if (lastSettings && raw === lastRaw) return lastSettings;
  lastRaw = raw;
  lastSettings = parseStored(raw);
  return lastSettings;
}

function write(next: Settings): void {
  const raw = JSON.stringify(next);
  try {
    localStorage.setItem(SETTINGS_KEY, raw);
    lastRaw = raw;
  } catch {
    // Storage can be unavailable (private mode, blocked site data); the value is kept in memory only.
  }
  lastSettings = next;
  for (const listener of listeners) listener();
}

/** Changes some settings, keeping the rest. A value the setting does not allow becomes its default. */
export function updateSettings(partial: Partial<Settings>): void {
  write(sanitize({ ...getSettings(), ...partial }));
}

export function resetSettings(): void {
  write(DEFAULT_SETTINGS);
}

export function subscribeSettings(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The settings, and setters that apply at once. The setters are stable across renders. */
export function useSettings(): [Settings, (partial: Partial<Settings>) => void, () => void] {
  const settings = useSyncExternalStore(subscribeSettings, getSettings, () => DEFAULT_SETTINGS);
  return [settings, updateSettings, resetSettings];
}
