import type { AdrMeta } from '@adrien/api/contract';

const CHANGED_FIELDS: Array<[keyof AdrMeta, string]> = [
  ['title', 'Title'],
  ['status', 'Status'],
  ['review_rule', 'Rule'],
  ['review_on', 'Review on'],
  ['tags', 'Tags'],
  ['components', 'Components'],
  ['code', 'Code anchors'],
  ['contested', 'Contested'],
  ['supersedes', 'Supersedes'],
  ['superseded_by', 'Superseded by'],
  ['related', 'Related'],
  ['exception_to', 'Exception to'],
];

function show(v: unknown): string {
  if (Array.isArray(v)) return v.join(', ') || 'none';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  return v === undefined || v === '' ? 'none' : String(v);
}

/** What a pending edit changes, field by field: the default branch on the left, this checkout on the right. */
export function ChangesPanel({ before, after }: { before: AdrMeta; after: AdrMeta }) {
  const changed = CHANGED_FIELDS.filter(([k]) => JSON.stringify(before[k]) !== JSON.stringify(after[k]));
  if (changed.length === 0) return <p>The frontmatter is unchanged; only the text differs.</p>;
  return (
    <dl className="space-y-2">
      {changed.map(([k, label]) => (
        <div key={k} className="grid gap-2 sm:grid-cols-[8rem_1fr_1fr]">
          <dt className="font-heading">{label}</dt>
          <dd className="panel p-4">
            <span className="block text-sm font-heading text-muted-foreground">On the default branch</span>
            {show(before[k])}
          </dd>
          <dd className="rounded-base border-2 border-dashed border-border bg-secondary-background p-4">
            <span className="block text-sm font-heading text-muted-foreground">In this checkout</span>
            {show(after[k])}
          </dd>
        </div>
      ))}
    </dl>
  );
}
