import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from '@/test/render.tsx';

describe('Skip link', () => {
  it('moves focus to the page without leaving the current route', async () => {
    renderApp('/adr/ADR-0002');
    await screen.findByRole('heading', { name: 'Use PostgreSQL as the system of record for billing' });
    await userEvent.click(screen.getByRole('button', { name: 'Skip to content' }));
    expect(document.getElementById('main')).toHaveFocus();
    expect(window.location.hash).toBe('');
    expect(
      screen.getByRole('heading', { name: 'Use PostgreSQL as the system of record for billing' }),
    ).toBeInTheDocument();
  });
});

describe('Brand', () => {
  it('shows the mark beside the name, hidden from assistive technology, in the theme ink', async () => {
    renderApp('/');
    const brand = await screen.findByRole('link', { name: 'Adrien' });
    const mark = brand.querySelector('svg');
    expect(mark).not.toBeNull();
    expect(mark).toHaveAttribute('aria-hidden', 'true');
    // The strokes follow the border colour, so the mark stays visible in the dark theme.
    expect(mark?.querySelector('g')).toHaveAttribute('stroke', 'var(--border)');
  });
});
