import type { Binding } from './status.ts';

/** How a decision is drawn, as plain facts, so the page, the board and the SVG graph all follow the same rules. */
export interface SurfaceTraits {
  /** The outline: dashed for a change that is not merged, solid otherwise. */
  border: 'solid' | 'dashed';
  /** The offset shadow behind the object: dashed when it claims an authority it cannot prove. */
  shadow: 'solid' | 'dashed';
  /** A hatched band along the top edge, for a change that is not merged yet. */
  band: boolean;
  /** A caution-coloured notch on a corner, for a claim that cannot be verified. */
  notch: boolean;
  /** The strip in the status colour: only a decision in force has one. */
  statusEdge: boolean;
  /** Muted ink for a decision that no longer applies; still readable (see the contrast test). */
  reducedInk: boolean;
}

/** The one place that maps a binding state to how it is drawn. Components draw what this returns. */
export function surfaceTraits(binding: Binding, retired: boolean): SurfaceTraits {
  return {
    border: binding === 'pending' ? 'dashed' : 'solid',
    shadow: binding === 'unverified' ? 'dashed' : 'solid',
    band: binding === 'pending',
    notch: binding === 'unverified',
    statusEdge: binding === 'binding',
    reducedInk: retired,
  };
}
