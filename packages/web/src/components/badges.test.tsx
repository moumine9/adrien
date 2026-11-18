import { render, screen } from '@testing-library/react';
import { STATUS_STYLES } from '@/lib/status.ts';
import { BindingBadge, DueBadge, PendingBadge, StatusBadge } from './badges.tsx';

describe('StatusBadge', () => {
  it('shows the status label on its status colour', () => {
    render(<StatusBadge status="superseded" />);
    const badge = screen.getByText('Superseded').closest('[data-status]') as HTMLElement;
    expect(badge).toHaveAttribute('data-status', 'superseded');
    expect(badge.style.backgroundColor).toBeTruthy();
    expect(badge).toHaveAttribute('title', STATUS_STYLES.superseded.meaning);
  });
});

describe('BindingBadge', () => {
  it('stamps a binding decision', () => {
    render(<BindingBadge binding="binding" />);
    expect(screen.getByText('Binding')).toBeInTheDocument();
  });

  it('says when binding cannot be verified', () => {
    render(<BindingBadge binding="unverified" />);
    expect(screen.getByText('Unverified')).toBeInTheDocument();
    expect(screen.getByText('Unverified').closest('[title]')).toHaveAttribute(
      'title',
      expect.stringContaining('no default branch'),
    );
  });

  it('marks a pending decision as not binding', () => {
    render(<BindingBadge binding="pending" />);
    expect(screen.getByText('Not binding')).toBeInTheDocument();
  });

  it('shows nothing for a decision that is simply not accepted', () => {
    const { container } = render(<BindingBadge binding="not-binding" />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('PendingBadge', () => {
  it.each([
    ['added', 'Pending addition'],
    ['modified', 'Pending edit'],
    ['deleted', 'Pending removal'],
  ] as const)('names a %s change', (kind, text) => {
    render(<PendingBadge kind={kind} />);
    expect(screen.getByText(text)).toBeInTheDocument();
  });
});

describe('DueBadge', () => {
  it('says the review is due', () => {
    render(<DueBadge />);
    expect(screen.getByText('Review due')).toBeInTheDocument();
  });
});
