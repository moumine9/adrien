import { screen, within } from '@testing-library/react';
import { renderApp } from '@/test/render.tsx';

const theme = () => screen.getByRole('combobox', { name: 'Theme' });
const refresh = () => screen.getByRole('combobox', { name: 'Refresh every' });

beforeEach(() => {
  localStorage.clear();
  document.documentElement.className = '';
});

describe('Settings page', () => {
  it('has a title and three groups, Appearance, Updates and Details, with a reset button', async () => {
    renderApp('/settings');
    expect(await screen.findByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument();
    const appearance = screen.getByRole('region', { name: 'Appearance' });
    const updates = screen.getByRole('region', { name: 'Updates' });
    const details = screen.getByRole('region', { name: 'Details' });
    expect(within(appearance).getByRole('combobox', { name: 'Theme' })).toBeInTheDocument();
    expect(within(updates).getByRole('combobox', { name: 'Refresh every' })).toBeInTheDocument();
    expect(within(details).getByRole('switch', { name: 'Show revision' })).toBeInTheDocument();
    expect(screen.getAllByRole('region')).toHaveLength(3);
    expect(screen.getByRole('button', { name: 'Reset to defaults' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
  });

  it('shows only settings that do something: one switch, Show revision', async () => {
    renderApp('/settings');
    await screen.findByRole('heading', { level: 1, name: 'Settings' });
    expect(screen.getAllByRole('switch').map((el) => el.getAttribute('aria-label') ?? el.id)).toHaveLength(1);
  });

  describe('Show revision', () => {
    const revision = () => screen.getByRole('switch', { name: 'Show revision' });

    it('is on by default, explains itself, and applies a change at once', async () => {
      const { user } = renderApp('/settings');
      await screen.findByRole('heading', { level: 1, name: 'Settings' });
      expect(revision()).toBeChecked();
      expect(revision()).toHaveAccessibleDescription(/revision/);
      await user.click(revision());
      expect(revision()).not.toBeChecked();
      expect(JSON.parse(localStorage.getItem('adrien.settings') ?? '{}')).toMatchObject({ showRevision: false });
    });

    it('is put back by Reset to defaults', async () => {
      const { user } = renderApp('/settings');
      await screen.findByRole('heading', { level: 1, name: 'Settings' });
      await user.click(revision());
      await user.click(screen.getByRole('button', { name: 'Reset to defaults' }));
      expect(revision()).toBeChecked();
    });
  });

  it('gives each control a one-line explanation', async () => {
    renderApp('/settings');
    await screen.findByRole('heading', { level: 1, name: 'Settings' });
    expect(theme()).toHaveAccessibleDescription('Follow the system, or always use light or dark colours.');
    expect(refresh()).toHaveAccessibleDescription(
      'How often the page asks the server for changes. Off stops automatic checks.',
    );
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

  it('resets every setting to its default', async () => {
    const { user } = renderApp('/settings');
    await screen.findByRole('heading', { level: 1, name: 'Settings' });
    await user.selectOptions(theme(), 'dark');
    await user.selectOptions(refresh(), '0');
    await user.click(screen.getByRole('button', { name: 'Reset to defaults' }));
    expect(theme()).toHaveValue('system');
    expect(refresh()).toHaveValue('5');
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
