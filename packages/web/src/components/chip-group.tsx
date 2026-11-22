import type { Tag } from 'lucide-react';
import { Toggle } from '@/components/ui/toggle.tsx';

export function ChipGroup({
  legend,
  hint,
  values,
  selected,
  icon: Icon,
  onToggle,
}: {
  legend: string;
  hint: string;
  values: string[];
  selected: string[];
  icon: typeof Tag;
  onToggle: (value: string) => void;
}) {
  if (values.length === 0) return null;
  return (
    <fieldset className="space-y-2">
      <legend className="font-heading">{legend}</legend>
      <p className="text-muted-foreground">{hint}</p>
      <div className="flex flex-wrap gap-2">
        {values.map((v) => (
          <Toggle
            key={v}
            size="sm"
            pressed={selected.includes(v)}
            onPressedChange={() => onToggle(v)}
            className="gap-2 font-semibold data-pressed:shadow-shadow"
          >
            <Icon aria-hidden className="size-3.5" strokeWidth={2.5} />
            {v}
          </Toggle>
        ))}
      </div>
    </fieldset>
  );
}
