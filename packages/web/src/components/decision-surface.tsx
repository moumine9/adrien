import type { ComponentPropsWithoutRef, ElementType, ReactNode } from 'react';
import { type Binding, STATUS_STYLES } from '@/lib/status.ts';
import { surfaceTraits } from '@/lib/surface.ts';
import { cn } from '@/lib/utils.ts';
import { PendingBand } from './pending-band.tsx';

type SurfaceProps<T extends ElementType> = {
  binding: Binding;
  /** Superseded, deprecated or rejected: drawn the same way, in muted ink. */
  retired?: boolean;
  /** Moves into its shadow on hover, for an object that is a link. */
  interactive?: boolean;
  as?: T;
  className?: string;
  children?: ReactNode;
} & Omit<ComponentPropsWithoutRef<T>, 'as' | 'className' | 'children'>;

/**
 * The frame a decision is drawn in. `surfaceTraits` decides how a binding state looks; this component draws it. The
 * outer element carries the semantics and the dashed shadow of an unverified decision (an outline offset behind the
 * box, which `box-shadow` cannot draw); the box inside clips the band and the edge to its rounded corners.
 */
export function DecisionSurface<T extends ElementType = 'div'>({
  binding,
  retired = false,
  interactive = false,
  as,
  className,
  children,
  ...rest
}: SurfaceProps<T>) {
  const Tag: ElementType = as ?? 'div';
  const traits = surfaceTraits(binding, retired);
  return (
    <Tag
      data-binding={binding}
      data-retired={retired || undefined}
      className={cn('group relative', className)}
      {...rest}
    >
      {traits.shadow === 'dashed' && (
        <span
          aria-hidden
          data-surface-shadow="dashed"
          className={cn(
            'pointer-events-none absolute inset-0 translate-x-boxShadowX translate-y-boxShadowY rounded-base border-2 border-dashed border-(--shadow-color)',
            interactive && 'group-hover:opacity-0',
          )}
        />
      )}
      <div
        data-surface-box
        className={cn(
          'relative flex flex-col overflow-hidden rounded-base border-2 border-border bg-secondary-background',
          traits.border === 'dashed' && 'border-dashed',
          traits.shadow === 'solid' && 'shadow-shadow',
          interactive &&
            'group-hover:translate-x-boxShadowX group-hover:translate-y-boxShadowY group-hover:shadow-none has-[a:focus-visible]:outline-3 has-[a:focus-visible]:outline-offset-2 has-[a:focus-visible]:outline-ring',
          traits.reducedInk && 'text-muted-foreground',
        )}
      >
        {traits.notch && (
          <span
            aria-hidden
            data-surface-notch
            className="absolute top-0 right-0 size-0 border-t-[1.5rem] border-l-[1.5rem] border-t-caution border-l-transparent"
          />
        )}
        {traits.band && <PendingBand />}
        <div className="flex min-w-0 flex-1">
          {traits.statusEdge && (
            <div
              aria-hidden
              data-surface-edge
              className="w-2.5 shrink-0 border-r border-rule"
              style={{ backgroundColor: STATUS_STYLES.accepted.fill }}
            />
          )}
          <div className="min-w-0 flex-1">{children}</div>
        </div>
      </div>
    </Tag>
  );
}
