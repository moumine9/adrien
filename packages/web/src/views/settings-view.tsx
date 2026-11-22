import type { ReactNode } from 'react';
import { type Option, SelectRow } from '@/components/select-row.tsx';
import { PageHeader } from '@/components/states.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Label } from '@/components/ui/label.tsx';
import { Switch } from '@/components/ui/switch.tsx';
import { type RefreshSeconds, type ThemeSetting, useSettings } from '@/lib/settings.ts';

const THEME_OPTIONS: Option[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

const REFRESH_OPTIONS: Option[] = [
  { value: '0', label: 'Off' },
  { value: '5', label: '5 seconds' },
  { value: '15', label: '15 seconds' },
  { value: '30', label: '30 seconds' },
  { value: '60', label: '1 minute' },
];

function SwitchRow({
  id,
  label,
  hint,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  hint: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  const hintId = `${id}-hint`;
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <Switch id={id} checked={checked} aria-describedby={hintId} onCheckedChange={onChange} />
        <Label htmlFor={id}>{label}</Label>
      </div>
      <p id={hintId} className="text-sm text-muted-foreground">
        {hint}
      </p>
    </div>
  );
}

function Group({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="space-y-4">
      <h2 id={id} className="text-xl">
        {title}
      </h2>
      {children}
    </section>
  );
}

export function SettingsView() {
  const [settings, update, reset] = useSettings();

  return (
    <div className="max-w-[68ch] space-y-8">
      <title>Settings | Adrien</title>
      <PageHeader title="Settings" />

      <Group id="settings-appearance" title="Appearance">
        <SelectRow
          id="settings-theme"
          label="Theme"
          hint="Follow the system, or always use light or dark colours."
          value={settings.theme}
          options={THEME_OPTIONS}
          onChange={(value) => update({ theme: value as ThemeSetting })}
        />
      </Group>

      <Group id="settings-updates" title="Updates">
        <SelectRow
          id="settings-refresh"
          label="Refresh every"
          hint="How often the page asks the server for changes. Off stops automatic checks."
          value={String(settings.refreshSeconds)}
          options={REFRESH_OPTIONS}
          onChange={(value) => update({ refreshSeconds: Number(value) as RefreshSeconds })}
        />
      </Group>

      <Group id="settings-details" title="Details">
        <SwitchRow
          id="settings-revision"
          label="Show revision"
          hint="Show each decision's revision, the value an agent passes to base its change on this version."
          checked={settings.showRevision}
          onChange={(showRevision) => update({ showRevision })}
        />
        <SwitchRow
          id="settings-change-notifications"
          label="Show change notifications"
          hint="Tell me when decisions change while this page is open."
          checked={settings.changeNotifications}
          onChange={(changeNotifications) => update({ changeNotifications })}
        />
      </Group>

      <div>
        <Button variant="neutral" onClick={reset}>
          Reset to defaults
        </Button>
      </div>
    </div>
  );
}
