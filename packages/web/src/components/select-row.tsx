import { Label } from '@/components/ui/label.tsx';

export interface Option {
  value: string;
  label: string;
}

const selectClass =
  'flex h-10 w-full panel px-3 py-2 text-sm font-base text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 sm:w-64';

export function SelectRow({
  id,
  label,
  hint,
  value,
  options,
  onChange,
}: {
  id: string;
  label: string;
  hint: string;
  value: string;
  options: Option[];
  onChange: (value: string) => void;
}) {
  const hintId = `${id}-hint`;
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <select
        id={id}
        value={value}
        aria-describedby={hintId}
        onChange={(event) => onChange(event.target.value)}
        className={selectClass}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <p id={hintId} className="text-sm text-muted-foreground">
        {hint}
      </p>
    </div>
  );
}
