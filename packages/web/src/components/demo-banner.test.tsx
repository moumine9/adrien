import { render, screen } from '@testing-library/react';
import { DemoBanner } from './demo-banner.tsx';

describe('DemoBanner', () => {
  it('says the decisions are a sample, not a repository', () => {
    render(<DemoBanner />);
    expect(screen.getByText('Demo data.')).toBeInTheDocument();
    expect(screen.getByText(/Nothing on this page reads a repository/)).toBeInTheDocument();
  });
});
