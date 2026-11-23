import type { AdrRow } from '@adrien/api/contract';
import { Link } from 'react-router';
import { ApproveDisclosure } from '@/components/approve-disclosure.tsx';
import { Chip, InCheckoutBadge, LocalEditBadge, type LocalEditKind } from '@/components/badges.tsx';
import { DecisionSurface } from '@/components/decision-surface.tsx';
import { bindingOf, isRetired, type Verification } from '@/lib/status.ts';
import { useWorkspacePath } from '@/lib/workspace.ts';

export function BoardCard({
  row,
  verification,
  localEdit,
}: {
  row: AdrRow;
  verification: Verification;
  localEdit?: LocalEditKind;
}) {
  const pending = row.layer === 'pending';
  const wp = useWorkspacePath();
  return (
    <DecisionSurface as="article" binding={bindingOf(row, verification)} retired={isRetired(row.status)}>
      <div className="space-y-2 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-heading tabular-nums">{row.id}</span>
          {pending && <InCheckoutBadge />}
          {localEdit && <LocalEditBadge kind={localEdit} />}
        </div>
        <h3 className="text-base leading-snug">
          <Link to={wp(`/adr/${encodeURIComponent(row.id)}`)} className="rounded-base focus-ring hover-underline">
            {row.title}
          </Link>
        </h3>
        {row.tags.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {row.tags.map((t) => (
              <Chip key={t} iconId="tag">
                {t}
              </Chip>
            ))}
          </div>
        )}
        {row.status === 'proposed' && <ApproveDisclosure id={row.id} />}
      </div>
    </DecisionSurface>
  );
}
