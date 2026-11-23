import type { AdrMeta } from '@adrien/api/contract';
import { render, screen } from '@testing-library/react';
import { ChangesPanel } from './changes-panel.tsx';

function meta(over: Partial<AdrMeta> = {}): AdrMeta {
  return {
    id: 'ADR-0012',
    title: 'T',
    status: 'accepted',
    tags: [],
    components: [],
    code: [],
    sources: [],
    supersedes: [],
    related: [],
    exception_to: [],
    deciders: [],
    origin: 'manual',
    contested: false,
    extra: {},
    ...over,
  };
}

describe('ChangesPanel', () => {
  it('shows a change to exception_to, which widens or narrows what a decision exempts', () => {
    render(<ChangesPanel before={meta()} after={meta({ exception_to: ['common/ADR-0004'] })} />);
    expect(screen.getByText('Exception to')).toBeTruthy();
    expect(screen.getByText('common/ADR-0004')).toBeTruthy();
    expect(screen.queryByText(/frontmatter is unchanged/)).toBeNull();
  });

  it('says the frontmatter is unchanged when no compared field differs', () => {
    render(<ChangesPanel before={meta()} after={meta()} />);
    expect(screen.getByText(/frontmatter is unchanged/)).toBeTruthy();
  });
});
