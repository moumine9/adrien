import { render, screen } from '@testing-library/react';
import type { Binding } from '@/lib/status.ts';
import { DecisionSurface } from './decision-surface.tsx';

function surface(binding: Binding, extra: { retired?: boolean; interactive?: boolean } = {}) {
  const view = render(
    <DecisionSurface binding={binding} as="article" {...extra}>
      <p>Content</p>
    </DecisionSurface>,
  );
  const root = view.container.querySelector('article') as HTMLElement;
  return {
    root,
    box: root.querySelector('[data-surface-box]') as HTMLElement,
    band: root.querySelector('.hatch'),
    notch: root.querySelector('[data-surface-notch]'),
    edge: root.querySelector('[data-surface-edge]'),
    dashedShadow: root.matches('[data-surface-shadow="dashed"]') ? root : null,
  };
}

describe('DecisionSurface', () => {
  it('draws a binding decision solid, raised, with its status edge in the status colour', () => {
    const s = surface('binding');
    expect(s.root).toHaveAttribute('data-binding', 'binding');
    expect(s.box).not.toHaveClass('border-dashed');
    expect(s.box).toHaveClass('shadow-shadow');
    expect(s.edge).toBe(s.box);
    expect(s.edge).toHaveClass('status-edge');
    expect(s.edge).toHaveStyle('--edge: #3dd68c');
    expect(s.band).toBeNull();
    expect(s.notch).toBeNull();
    expect(s.dashedShadow).toBeNull();
  });

  it('draws an unverified decision solid, with a dashed shadow instead of a raised one, a notch and no edge', () => {
    const s = surface('unverified');
    expect(s.root).toHaveAttribute('data-binding', 'unverified');
    expect(s.box).not.toHaveClass('border-dashed');
    expect(s.box).not.toHaveClass('shadow-shadow');
    // Drawn by the root's own ::before, so it costs no element; in the colour of the solid shadows.
    expect(s.dashedShadow).toHaveClass('dashed-shadow');
    expect(s.root.querySelector('span[aria-hidden]:not([data-surface-notch])')).toBeNull();
    expect(s.notch).toHaveAttribute('aria-hidden', 'true');
    expect(s.edge).toBeNull();
  });

  it('draws a pending change with a dashed border, a shadow and a hatched band that sits on no text', () => {
    const s = surface('pending');
    expect(s.root).toHaveAttribute('data-binding', 'pending');
    expect(s.box).toHaveClass('border-dashed');
    expect(s.box).toHaveClass('shadow-shadow');
    expect(s.band).toHaveAttribute('aria-hidden', 'true');
    expect(s.root.querySelectorAll('.hatch')).toHaveLength(1);
    expect(screen.getByText('Content').closest('.hatch')).toBeNull();
    expect(s.edge).toBeNull();
    expect(s.notch).toBeNull();
  });

  it('draws a decision that is not binding solid and raised, with the status badge as its only colour', () => {
    const s = surface('not-binding');
    expect(s.root).toHaveAttribute('data-binding', 'not-binding');
    expect(s.box).not.toHaveClass('border-dashed');
    expect(s.box).toHaveClass('shadow-shadow');
    expect(s.edge).toBeNull();
    expect(s.band).toBeNull();
    expect(s.notch).toBeNull();
  });

  it('marks a retired decision and mutes its ink without fading the box', () => {
    const s = surface('not-binding', { retired: true });
    expect(s.root).toHaveAttribute('data-retired', 'true');
    expect(s.box).toHaveClass('text-muted-foreground');
    expect(s.box.className).not.toMatch(/opacity/);
    expect(surface('not-binding').root).not.toHaveAttribute('data-retired');
  });

  it('moves into its shadow on hover only when it is interactive, and the dashed shadow goes with it', () => {
    expect(surface('binding').box).not.toHaveClass('group-hover:shadow-none');
    expect(surface('binding', { interactive: true }).box).toHaveClass('group-hover:shadow-none');
    expect(surface('unverified', { interactive: true }).dashedShadow).toHaveClass('hover:before:opacity-0');
    expect(surface('unverified').dashedShadow).not.toHaveClass('hover:before:opacity-0');
  });

  it('adds no wrapper around its children, with or without an edge', () => {
    for (const binding of ['binding', 'unverified', 'not-binding'] as const) {
      const s = surface(binding);
      expect(screen.getAllByText('Content').at(-1)?.parentElement).toBe(s.box);
    }
    const { box } = surface('binding');
    expect(box.parentElement).toHaveAttribute('data-binding', 'binding');
    // The outer element, the box and the children: three levels, nothing else.
    expect(box.parentElement?.children).toHaveLength(1);
  });
});
