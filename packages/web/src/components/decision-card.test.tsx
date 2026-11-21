import type { AdrListRow } from '@adrien/api/contract';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { DecisionCard } from './decision-card.tsx';

const pendingRow = {
  id: 'ADR-0007',
  title: 'Use PostgreSQL for billing',
  status: 'proposed',
  layer: 'pending',
  pending_kind: 'added',
  review_rule: null,
  tags: [],
  components: [],
} as unknown as AdrListRow;

function renderCard(row: AdrListRow, verification: 'verified' | 'unverified' = 'verified') {
  return render(
    <MemoryRouter>
      <DecisionCard row={row} verification={verification} />
    </MemoryRouter>,
  );
}

describe('DecisionCard', () => {
  it('hatches only a band along the top edge of a pending card, never the text', () => {
    const { container } = renderCard(pendingRow);
    const article = container.querySelector('article') as HTMLElement;
    expect(article).toHaveAttribute('data-binding', 'pending');
    expect(article).not.toHaveClass('hatch');
    const band = container.querySelector('.hatch') as HTMLElement;
    expect(band).toHaveAttribute('aria-hidden', 'true');
    // The only hatched element is the band: no badge or title sits on the pattern.
    expect(container.querySelectorAll('.hatch')).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'Use PostgreSQL for billing' }).closest('.hatch')).toBeNull();
  });

  it('draws no band on a card that is not pending', () => {
    const { container } = renderCard({ ...pendingRow, layer: 'base', pending_kind: null } as unknown as AdrListRow);
    expect(container.querySelector('.hatch')).toBeNull();
  });
});

describe('DecisionCard authority', () => {
  const base = { ...pendingRow, layer: 'base', pending_kind: null } as unknown as AdrListRow;
  const draw = (row: AdrListRow, verification: 'verified' | 'unverified' = 'verified') => {
    const { container } = renderCard(row, verification);
    return container.querySelector('article') as HTMLElement;
  };

  it('draws an accepted decision on the default branch as binding, with its status edge', () => {
    const card = draw({ ...base, status: 'accepted' } as AdrListRow);
    expect(card).toHaveAttribute('data-binding', 'binding');
    expect(card.querySelector('[data-surface-edge]')).not.toBeNull();
  });

  it('draws an accepted decision that no default branch backs as unverified, with a notch and no edge', () => {
    const card = draw({ ...base, status: 'accepted' } as AdrListRow, 'unverified');
    expect(card).toHaveAttribute('data-binding', 'unverified');
    expect(card.querySelector('[data-surface-notch]')).not.toBeNull();
    expect(card.querySelector('[data-surface-edge]')).toBeNull();
  });

  it('gives a proposed decision no status edge, and mutes a retired one', () => {
    expect(draw({ ...base, status: 'proposed' } as AdrListRow).querySelector('[data-surface-edge]')).toBeNull();
    const retired = draw({ ...base, status: 'rejected' } as AdrListRow);
    expect(retired).toHaveAttribute('data-retired', 'true');
    expect(retired).toHaveAttribute('data-binding', 'not-binding');
  });
});
