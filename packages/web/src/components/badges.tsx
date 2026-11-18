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

const base = 'h-6 gap-1.5 px-2 text-[0.8125rem] leading-none font-heading [&>svg]:size-3.5';

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
    tone: 'hatch bg-secondary-background text-foreground border-dashed',
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
      className={cn(base, 'hatch border-dashed bg-secondary-background text-foreground', className)}
    >
      <Icon aria-hidden strokeWidth={2.5} />
      {p.label}
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
  className,
}: {
  children: ReactNode;
  icon?: LucideIcon;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex h-6 items-center gap-1 rounded-base border-2 border-border bg-background px-1.5 text-[0.8125rem] leading-none font-semibold',
        className,
      )}
    >
      {Icon && <Icon aria-hidden className="size-3.5 opacity-70" strokeWidth={2.5} />}
      {children}
    </span>
  );
}
