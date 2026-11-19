import { screen, waitFor, within } from '@testing-library/react';
import { renderApp } from '@/test/render.tsx';

const theme = () => screen.getByRole('combobox', { name: 'Theme' });
const refresh = () => screen.getByRole('combobox', { name: 'Refresh every' });
const notify = () => screen.getByRole('switch', { name: 'Show change notifications' });
const revision = () => screen.getByRole('switch', { name: 'Show revision' });

beforeEach(() => {
  localStorage.clear();
  document.documentElement.className = '';
});

describe('Settings page', () => {
  it('has a title and three groups, each with its controls', async () => {
    renderApp('/settings');
    expect(await screen.findByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument();
    const appearance = screen.getByRole('region', { name: 'Appearance' });
    const updates = screen.getByRole('region', { name: 'Updates' });
    const details = screen.getByRole('region', { name: 'Details' });
    expect(within(appearance).getByRole('combobox', { name: 'Theme' })).toBeInTheDocument();
    expect(within(updates).getByRole('combobox', { name: 'Refresh every' })).toBeInTheDocument();
    expect(within(updates).getByRole('switch', { name: 'Show change notifications' })).toBeInTheDocument();
    expect(within(details).getByRole('switch', { name: 'Show revision' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reset to defaults' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
  });

  it('gives each control a one-line explanation', async () => {
    renderApp('/settings');
    await screen.findByRole('heading', { level: 1, name: 'Settings' });
    expect(theme()).toHaveAccessibleDescription('Follow the system, or always use light or dark colours.');
    expect(refresh()).toHaveAccessibleDescription('How often the page checks for changes.');
    expect(notify()).toHaveAccessibleDescription('Show a notice when a decision changes while the page is open.');
    expect(revision()).toHaveAccessibleDescription('Show the revision of the log each page was read from.');
  });

  describe('Theme', () => {
    it('defaults to System', async () => {
      renderApp('/settings');
      await screen.findByRole('heading', { level: 1, name: 'Settings' });
      expect(theme()).toHaveValue('system');
      expect(
        within(theme())
          .getAllByRole('option')
          .map((o) => o.textContent),
      ).toEqual(['System', 'Light', 'Dark']);
    });

    it('applies a change at once and stores it', async () => {
      const { user } = renderApp('/settings');
      await screen.findByRole('heading', { level: 1, name: 'Settings' });
      await user.selectOptions(theme(), 'dark');
      expect(document.documentElement.classList.contains('dark')).toBe(true);
      expect(JSON.parse(localStorage.getItem('adrien.settings') ?? '{}')).toMatchObject({ theme: 'dark' });
    });

    it('keeps the choice after a remount', async () => {
      const first = renderApp('/settings');
      await screen.findByRole('heading', { level: 1, name: 'Settings' });
      await first.user.selectOptions(theme(), 'light');
      first.unmount();
      renderApp('/settings');
      expect(await screen.findByRole('combobox', { name: 'Theme' })).toHaveValue('light');
    });
  });

  describe('Refresh every', () => {
    it('defaults to 5 seconds', async () => {
      renderApp('/settings');
      await screen.findByRole('heading', { level: 1, name: 'Settings' });
      expect(refresh()).toHaveValue('5');
      expect(
        within(refresh())
          .getAllByRole('option')
          .map((o) => o.textContent),
      ).toEqual(['Off', '5 seconds', '15 seconds', '30 seconds', '1 minute']);
    });

    it('stores a change and keeps it after a remount', async () => {
      const first = renderApp('/settings');
      await screen.findByRole('heading', { level: 1, name: 'Settings' });
      await first.user.selectOptions(refresh(), '60');
      expect(JSON.parse(localStorage.getItem('adrien.settings') ?? '{}')).toMatchObject({ refreshSeconds: 60 });
      first.unmount();
      renderApp('/settings');
      expect(await screen.findByRole('combobox', { name: 'Refresh every' })).toHaveValue('60');
    });
  });

  describe('Show change notifications', () => {
    it('defaults to on, and a click turns it off and stores it', async () => {
      const first = renderApp('/settings');
      await screen.findByRole('heading', { level: 1, name: 'Settings' });
      expect(notify()).toBeChecked();
      await first.user.click(notify());
      expect(notify()).not.toBeChecked();
      first.unmount();
      renderApp('/settings');
      expect(await screen.findByRole('switch', { name: 'Show change notifications' })).not.toBeChecked();
    });
  });

  describe('Show revision', () => {
    it('defaults to on, and a click turns it off and stores it', async () => {
      const first = renderApp('/settings');
      await screen.findByRole('heading', { level: 1, name: 'Settings' });
      expect(revision()).toBeChecked();
      await first.user.click(revision());
      expect(revision()).not.toBeChecked();
      first.unmount();
      renderApp('/settings');
      expect(await screen.findByRole('switch', { name: 'Show revision' })).not.toBeChecked();
    });
  });

  it('resets every setting to its default', async () => {
    const { user } = renderApp('/settings');
    await screen.findByRole('heading', { level: 1, name: 'Settings' });
    await user.selectOptions(theme(), 'dark');
    await user.selectOptions(refresh(), '0');
    await user.click(notify());
    await user.click(revision());
    await user.click(screen.getByRole('button', { name: 'Reset to defaults' }));
    await waitFor(() => expect(theme()).toHaveValue('system'));
    expect(refresh()).toHaveValue('5');
    expect(notify()).toBeChecked();
    expect(revision()).toBeChecked();
  });

  it('keeps the header theme toggle and the Theme select in step', async () => {
    const { user } = renderApp('/settings');
    await screen.findByRole('heading', { level: 1, name: 'Settings' });
    await user.click(screen.getByRole('button', { name: 'Use the dark theme' }));
    expect(theme()).toHaveValue('dark');
    await user.selectOptions(theme(), 'light');
    expect(screen.getByRole('button', { name: 'Use the dark theme' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Use the dark theme' }));
    expect(theme()).toHaveValue('dark');
  });
});
