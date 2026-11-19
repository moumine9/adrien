import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SETTINGS_KEY } from '@/lib/settings.ts';
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

describe('Theme across tabs', () => {
  afterEach(() => {
    localStorage.clear();
    document.documentElement.className = '';
  });

  it('switches the page theme when another tab changes the setting', async () => {
    renderApp('/');
    await screen.findByRole('link', { name: 'Decisions' });
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ theme: 'dark' }));
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: SETTINGS_KEY }));
    });
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(screen.getByRole('button', { name: 'Use the light theme' })).toBeInTheDocument();
  });
});

describe('Settings link', () => {
  it('is the last entry of the main navigation, with a gear icon beside its label', async () => {
    renderApp('/');
    const nav = await screen.findByRole('navigation', { name: 'Main' });
    const links = within(nav).getAllByRole('link');
    const settings = links.at(-1);
    expect(settings).toHaveTextContent('Settings');
    expect(settings).toHaveAttribute('href', '/settings');
    expect(settings?.querySelector('svg')).toHaveClass('opacity-70');
  });

  it('opens the settings page', async () => {
    const { user } = renderApp('/');
    await user.click(await screen.findByRole('link', { name: 'Settings' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute('aria-current', 'page');
  });
});

describe('Navigation icons', () => {
  it('draws a nav icon lighter than its label, beside it', async () => {
    renderApp('/');
    const link = await screen.findByRole('link', { name: 'Decisions' });
    const icon = link.querySelector('svg');
    expect(icon).toHaveClass('opacity-70');
    expect(icon).toHaveAttribute('stroke-width', '2');
  });

  it('keeps the theme toggle icon at full strength', async () => {
    renderApp('/');
    const toggle = await screen.findByRole('button', { name: /Use the (dark|light) theme/ });
    expect(toggle.querySelector('svg')).not.toHaveClass('opacity-70');
  });
});
