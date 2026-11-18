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
