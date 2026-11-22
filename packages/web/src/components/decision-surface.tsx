import type { ComponentPropsWithoutRef, CSSProperties, ElementType, ReactNode } from 'react';
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
 * outer element carries the semantics and the dashed shadow of an unverified decision (its `::before`, an outline
 * offset behind the box, which `box-shadow` cannot draw); the box inside clips the band and the edge to its rounded
 * corners. The edge is the box's own `::before`, so neither costs an element.
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
      data-surface-shadow={traits.shadow === 'dashed' ? 'dashed' : undefined}
      className={cn(
        'group relative',
        traits.shadow === 'dashed' && 'dashed-shadow',
        traits.shadow === 'dashed' && interactive && 'hover:before:opacity-0',
        className,
      )}
      {...rest}
    >
      <div
        data-surface-box
        // Only a binding decision has an edge, and binding means accepted: the colour is the accepted one.
        data-surface-edge={traits.statusEdge || undefined}
        style={traits.statusEdge ? ({ '--edge': STATUS_STYLES.accepted.fill } as CSSProperties) : undefined}
        className={cn(
          'relative flex flex-col overflow-hidden panel',
          traits.statusEdge && 'status-edge',
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
        {children}
      </div>
    </Tag>
  );
}
