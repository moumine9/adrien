import { focusManager, type QueryClient } from '@tanstack/react-query';
import { act, screen, waitFor } from '@testing-library/react';
import { updateSettings } from '@/lib/settings.ts';
import { type Moved, movingFetch } from '@/test/moving-fetch.ts';
import { renderApp } from '@/test/render.tsx';

const OLD = 'Use PostgreSQL as the system of record for billing';
const NEW = 'Use PostgreSQL, and only PostgreSQL, for billing';
const ELSEWHERE = 'ADR-0001';

async function openDecision(patchRef: { current: Record<string, Moved> }) {
  const app = renderApp('/adr/ADR-0002', { fetch: movingFetch(() => patchRef.current) });
  await screen.findByRole('heading', { level: 1, name: OLD });
  // The list is what the app polls; its first reading is the baseline.
  await waitFor(() => expect(app.client.getQueryData(['adrs', ''])).toBeDefined());
  return app;
}

async function pollList(client: QueryClient) {
  await act(async () => {
    await client.refetchQueries({ queryKey: ['adrs'] });
  });
}

beforeEach(() => {
  localStorage.clear();
  updateSettings({ changeNotifications: true });
});

describe('A decision that changes while it is open', () => {
  it('keeps the text it showed, says it is out of date, and offers to reload', async () => {
    const patch = { current: {} as Record<string, Moved> };
    const { client } = await openDecision(patch);
    expect(screen.queryByText('Changed since you opened this')).not.toBeInTheDocument();
    patch.current = { 'ADR-0002': { revision: 'abcdefabcdef', title: NEW } };
    await pollList(client);
    expect(await screen.findByText('Changed since you opened this')).toBeInTheDocument();
    expect(screen.getByTestId('change-toast')).toHaveTextContent('ADR-0002 changed.');
    expect(screen.getByRole('heading', { level: 1, name: OLD })).toBeInTheDocument();
  });

  it('does not swap the text under the reader when the window regains focus or the connection returns', async () => {
    const patch = { current: {} as Record<string, Moved> };
    const { client } = await openDecision(patch);
    patch.current = { 'ADR-0002': { revision: 'abcdefabcdef', title: NEW } };
    await pollList(client);
    await screen.findByText('Changed since you opened this');
    act(() => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
      window.dispatchEvent(new Event('online'));
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
    expect(screen.getByRole('heading', { level: 1, name: OLD })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 1, name: NEW })).not.toBeInTheDocument();
  });

  it('shows the new version, and says "Updated", once Reload is pressed', async () => {
    const patch = { current: {} as Record<string, Moved> };
    const { client, user } = await openDecision(patch);
    patch.current = { 'ADR-0002': { revision: 'abcdefabcdef', title: NEW } };
    await pollList(client);
    await user.click(await screen.findByRole('button', { name: 'Reload ADR-0002' }));
    expect(await screen.findByRole('heading', { level: 1, name: NEW })).toBeInTheDocument();
    expect(screen.queryByText('Changed since you opened this')).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('change-toast')).toHaveTextContent('Updated.'));
  });

  it('clears the notice too when the reader reloads from the page', async () => {
    const patch = { current: {} as Record<string, Moved> };
    const { client, user } = await openDecision(patch);
    patch.current = { 'ADR-0002': { revision: 'abcdefabcdef', title: NEW } };
    await pollList(client);
    await waitFor(() => expect(screen.getByTestId('change-toast')).toHaveTextContent('ADR-0002 changed.'));
    await user.click(screen.getByRole('button', { name: 'Reload' }));
    expect(await screen.findByRole('heading', { level: 1, name: NEW })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('change-toast')).toBeEmptyDOMElement());
  });

  it('does not take the notice away by itself while the decision is out of date', async () => {
    const patch = { current: {} as Record<string, Moved> };
    const { client } = await openDecision(patch);
    patch.current = { 'ADR-0002': { revision: 'abcdefabcdef', title: NEW } };
    await pollList(client);
    await screen.findByText('Changed since you opened this');
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 150));
    });
    expect(screen.getByTestId('change-toast')).toHaveTextContent('ADR-0002 changed.');
  });

  it('leaves the open decision alone when another one changes', async () => {
    const patch = { current: {} as Record<string, Moved> };
    const { client } = await openDecision(patch);
    patch.current = { [ELSEWHERE]: { revision: 'abcdefabcdef' } };
    await pollList(client);
    await waitFor(() => expect(screen.getByTestId('change-toast')).toHaveTextContent('ADR-0001 changed.'));
    expect(screen.queryByText('Changed since you opened this')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reload' })).not.toBeInTheDocument();
  });

  it('still says so on the page when change notifications are off, but sends no notice', async () => {
    updateSettings({ changeNotifications: false });
    const patch = { current: {} as Record<string, Moved> };
    const { client } = await openDecision(patch);
    patch.current = { 'ADR-0002': { revision: 'abcdefabcdef', title: NEW } };
    await pollList(client);
    expect(await screen.findByText('Changed since you opened this')).toBeInTheDocument();
    expect(screen.getByTestId('change-toast')).toBeEmptyDOMElement();
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument();
  });
});
