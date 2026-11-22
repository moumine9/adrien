import type { Status } from '@adrien/api/contract';
import {
  Archive,
  Ban,
  CalendarClock,
  Check,
  FileMinus,
  FilePen,
  FilePlus,
  GitPullRequestDraft,
  type LucideIcon,
  Replace,
  Scale,
  ShieldQuestionMark,
  Stamp,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { type IconName, Icon as SpriteIcon } from '@/components/icon.tsx';
import { Badge } from '@/components/ui/badge.tsx';
import { type Binding, STATUS_STYLES } from '@/lib/status.ts';
import { cn } from '@/lib/utils.ts';

/** Status is never told by colour alone: each one also has its own icon and label. */
export const STATUS_ICONS: Record<Status, LucideIcon> = {
  accepted: Check,
  proposed: Scale,
  superseded: Replace,
  deprecated: Archive,
  rejected: Ban,
};

/* Badges sit inside cards, so they take the 4 px inset radius and 8 by 4 padding (horizontal is twice the vertical). */
const base = 'caption rounded-inset gap-2 px-2 py-1 text-[0.8125rem] font-heading [&>svg]:size-3.5';

export function StatusBadge({ status, className }: { status: Status; className?: string }) {
  const style = STATUS_STYLES[status];
  const Icon = STATUS_ICONS[status];
  return (
    <Badge
      data-status={status}
      title={style.meaning}
      className={cn(base, 'text-ink', className)}
      style={{ backgroundColor: style.fill }}
    >
      <Icon aria-hidden strokeWidth={2.75} />
      {style.label}
    </Badge>
  );
}

const BINDING: Record<
  Exclude<Binding, 'not-binding'>,
  { label: string; title: string; icon: LucideIcon; tone: string }
> = {
  binding: {
    label: 'Binding',
    title: 'Accepted on the default branch: code must follow this decision.',
    icon: Stamp,
    tone: 'bg-foreground text-background border-border',
  },
  unverified: {
    label: 'Unverified',
    title: 'Accepted as written, but there is no default branch to confirm it was merged.',
    icon: ShieldQuestionMark,
    tone: 'bg-secondary-background text-foreground',
  },
  pending: {
    label: 'Not binding',
    title: 'A change in this checkout. It binds nothing until it is merged.',
    icon: GitPullRequestDraft,
    tone: 'bg-secondary-background text-foreground border-dashed',
  },
};

export function BindingBadge({ binding, className }: { binding: Binding; className?: string }) {
  if (binding === 'not-binding') return null;
  const b = BINDING[binding];
  const Icon = b.icon;
  return (
    <Badge data-binding={binding} title={b.title} className={cn(base, b.tone, className)}>
      <Icon aria-hidden strokeWidth={2.5} />
      {b.label}
    </Badge>
  );
}

const PENDING: Record<'added' | 'modified' | 'deleted', { label: string; icon: LucideIcon; title: string }> = {
  added: { label: 'Pending addition', icon: FilePlus, title: 'New in this checkout, not on the default branch yet.' },
  modified: { label: 'Pending edit', icon: FilePen, title: 'Edited in this checkout; the default branch still binds.' },
  deleted: {
    label: 'Pending removal',
    icon: FileMinus,
    title: 'Removed in this checkout; the default branch still has it.',
  },
};

export function PendingBadge({ kind, className }: { kind: 'added' | 'modified' | 'deleted'; className?: string }) {
  const p = PENDING[kind];
  const Icon = p.icon;
  return (
    <Badge
      data-pending={kind}
      title={p.title}
      className={cn(base, 'border-dashed bg-secondary-background text-foreground', className)}
    >
      <Icon aria-hidden strokeWidth={2.5} />
      {p.label}
    </Badge>
  );
}

export type LocalEditKind = 'modified' | 'deleted';

/** The local change to a decision whose base row is shown: it is the base row that stands on the board. */
const LOCAL_EDIT: Record<LocalEditKind, { label: string; icon: LucideIcon; title: string }> = {
  modified: { label: 'Edited in this checkout', icon: FilePen, title: PENDING.modified.title },
  deleted: { label: 'Deleted in this checkout', icon: FileMinus, title: PENDING.deleted.title },
};

export function LocalEditBadge({ kind, className }: { kind: LocalEditKind; className?: string }) {
  const edit = LOCAL_EDIT[kind];
  const Icon = edit.icon;
  return (
    <Badge
      data-local-edit={kind}
      title={edit.title}
      className={cn(base, 'border-dashed bg-secondary-background text-foreground', className)}
    >
      <Icon aria-hidden strokeWidth={2.5} />
      {edit.label}
    </Badge>
  );
}

/** A decision that exists only in this checkout: it binds nothing until it is merged. */
export function InCheckoutBadge({ className }: { className?: string }) {
  return (
    <Badge
      title="A change in this checkout. It binds nothing until it is merged."
      className={cn(base, 'border-dashed bg-secondary-background text-foreground', className)}
    >
      <GitPullRequestDraft aria-hidden strokeWidth={2.5} />
      Pending in this checkout
    </Badge>
  );
}

export function DueBadge({ className }: { className?: string }) {
  return (
    <Badge
      title="The review date has passed: check that this still holds."
      className={cn(base, 'bg-caution text-ink', className)}
    >
      <CalendarClock aria-hidden strokeWidth={2.5} />
      Review due
    </Badge>
  );
}

/** A small neutral chip for tags and components. */
export function Chip({
  children,
  icon: Icon,
  iconId,
  className,
}: {
  children: ReactNode;
  /** A Lucide icon, for one-off places. */
  icon?: LucideIcon;
  /** A sprite icon, for chips on the cards (one shared drawing in the DOM). */
  iconId?: IconName;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'caption inline-flex items-center gap-2 rounded-inset border-2 border-border bg-background px-2 py-1 text-[0.8125rem] font-semibold',
        className,
      )}
    >
      {Icon && <Icon aria-hidden className="size-3.5 opacity-70" strokeWidth={2.5} />}
      {iconId && <SpriteIcon name={iconId} className="size-3.5 opacity-70" strokeWidth={2.5} />}
      {children}
    </span>
  );
}
