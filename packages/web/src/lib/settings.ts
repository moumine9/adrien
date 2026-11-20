import { useSyncExternalStore } from 'react';

export const SETTINGS_KEY = 'adrien.settings';

/** The key the theme was stored under before the settings existed. */
const LEGACY_THEME_KEY = 'adrien-theme';

export const THEMES = ['system', 'light', 'dark'] as const;
export type ThemeSetting = (typeof THEMES)[number];

/** Seconds between checks for changes; 0 turns checking off. */
export const REFRESH_SECONDS = [0, 5, 15, 30, 60] as const;
export type RefreshSeconds = (typeof REFRESH_SECONDS)[number];

export interface Settings {
  theme: ThemeSetting;
  refreshSeconds: RefreshSeconds;
  /** Whether the revision (what `--expect` and `base_revision` take) is shown on cards and on the decision page. */
  showRevision: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  refreshSeconds: 5,
  showRevision: true,
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Takes each field from `value` when it is allowed, otherwise keeps the field of `base`. */
function pick(value: unknown, base: Settings): Settings {
  const record = isRecord(value) ? value : {};
  return {
    theme: THEMES.includes(record.theme as ThemeSetting) ? (record.theme as ThemeSetting) : base.theme,
    refreshSeconds: REFRESH_SECONDS.includes(record.refreshSeconds as RefreshSeconds)
      ? (record.refreshSeconds as RefreshSeconds)
      : base.refreshSeconds,
    showRevision: typeof record.showRevision === 'boolean' ? record.showRevision : base.showRevision,
  };
}

function parseStored(raw: string | null): Settings {
  if (raw === null) return DEFAULT_SETTINGS;
  try {
    return pick(JSON.parse(raw), DEFAULT_SETTINGS);
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function readLegacyTheme(): ThemeSetting | undefined {
  try {
    const value = localStorage.getItem(LEGACY_THEME_KEY);
    return value === 'light' || value === 'dark' ? value : undefined;
  } catch {
    return undefined;
  }
}

/** The settings as JSON, keeping any keys already stored that this version does not know. */
function serialize(next: Settings): string {
  let extra: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? 'null');
    if (isRecord(parsed)) extra = parsed;
  } catch {
    // Unreadable storage: write only the known settings.
  }
  return JSON.stringify({ ...extra, ...next });
}

// The last raw string seen in storage and the settings it produced. The object is reused while the
// raw string is unchanged, so useSyncExternalStore sees a stable snapshot. A write that cannot reach
// storage leaves `lastRaw` alone and still becomes the snapshot: the choice then lasts for the page.
let lastRaw: string | null | undefined;
let lastSettings: Settings | undefined;
const listeners = new Set<() => void>();

/** Seeds the settings from the old theme key, once, and removes that key. Memory keeps the seed if storage refuses. */
function seedFromLegacy(theme: ThemeSetting): Settings {
  const seeded: Settings = { ...DEFAULT_SETTINGS, theme };
  lastSettings = seeded;
  lastRaw = null;
  try {
    const raw = serialize(seeded);
    localStorage.setItem(SETTINGS_KEY, raw);
    lastRaw = raw;
    localStorage.removeItem(LEGACY_THEME_KEY);
  } catch {
    // Storage is unavailable: the seed lasts for the page only.
  }
  return seeded;
}

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
  if (raw === null) {
    const legacy = readLegacyTheme();
    if (legacy) return seedFromLegacy(legacy);
  }
  lastRaw = raw;
  lastSettings = parseStored(raw);
  return lastSettings;
}

function write(next: Settings): void {
  lastSettings = next;
  try {
    const raw = serialize(next);
    localStorage.setItem(SETTINGS_KEY, raw);
    lastRaw = raw;
  } catch {
    // Storage can be unavailable (private mode, blocked site data); the value is kept in memory only.
  }
  for (const listener of listeners) listener();
}

/** Changes some settings, keeping the rest. A value the setting does not allow keeps the current one. */
export function updateSettings(partial: Partial<Settings>): void {
  write(pick(partial, getSettings()));
}

export function resetSettings(): void {
  write(DEFAULT_SETTINGS);
}

/** Notifies on this page's changes and on changes made in another tab of the same origin. */
export function subscribeSettings(listener: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === SETTINGS_KEY || event.key === null) listener();
  };
  listeners.add(listener);
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

/** The settings, and setters that apply at once. The setters are stable across renders. */
export function useSettings(): [Settings, (partial: Partial<Settings>) => void, () => void] {
  const settings = useSyncExternalStore(subscribeSettings, getSettings, () => DEFAULT_SETTINGS);
  return [settings, updateSettings, resetSettings];
}
