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

function renderCard(row: AdrListRow) {
  return render(
    <MemoryRouter>
      <DecisionCard row={row} verification="verified" />
    </MemoryRouter>,
  );
}

describe('DecisionCard', () => {
  it('hatches only a band along the top edge of a pending card, never the text', () => {
    const { container } = renderCard(pendingRow);
    const article = container.querySelector('article') as HTMLElement;
    expect(article).not.toHaveClass('hatch');
    const band = article.firstElementChild as HTMLElement;
    expect(band).toHaveClass('hatch');
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
