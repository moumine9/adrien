import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { act, render, screen } from '@testing-library/react';
import { hangingFetch, renderApp } from '@/test/render.tsx';
import { LOADING_BAR_MIN_MS, LoadingBar } from './loading-bar.tsx';

describe('LoadingBar on the app shell', () => {
  it('shows while the page is fetching its data', async () => {
    renderApp('/', { fetch: hangingFetch });
    expect(await screen.findByTestId('loading-bar')).toHaveAttribute('aria-hidden', 'true');
  });
});

// Answers are resolved by hand, so the test decides when the query stops fetching.
const answers: Array<(value: string) => void> = [];

function Probe() {
  useQuery({
    queryKey: ['probe'],
    queryFn: () => new Promise<string>((resolve) => answers.push(resolve)),
  });
  return null;
}

describe('LoadingBar timing', () => {
  let client: QueryClient;

  const renderProbe = () =>
    render(
      <QueryClientProvider client={client}>
        <LoadingBar />
        <Probe />
      </QueryClientProvider>,
    );

  /** Lets the query cache notify its subscribers, under fake timers. */
  const flush = () => act(() => vi.advanceTimersByTime(0));

  beforeEach(() => {
    vi.useFakeTimers();
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });

  afterEach(() => {
    // Clear the client while its timers are still fake, then drop the answers no test resolved.
    client.clear();
    vi.useRealTimers();
    answers.length = 0;
  });

  it('stays visible at least the minimum time after it appeared, then hides', async () => {
    expect(LOADING_BAR_MIN_MS).toBe(400);
    renderProbe();
    flush();
    expect(screen.getByTestId('loading-bar')).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(100));
    await act(async () => {
      answers.shift()?.('ok');
      await vi.advanceTimersByTimeAsync(0);
    });
    act(() => vi.advanceTimersByTime(299));
    expect(screen.getByTestId('loading-bar')).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByTestId('loading-bar')).toBeNull();
  });

  it('shows again when a refetch starts after it hid', async () => {
    renderProbe();
    flush();
    act(() => vi.advanceTimersByTime(LOADING_BAR_MIN_MS));
    await act(async () => {
      answers.shift()?.('first');
      await vi.advanceTimersByTimeAsync(0);
    });
    act(() => vi.advanceTimersByTime(LOADING_BAR_MIN_MS));
    expect(screen.queryByTestId('loading-bar')).toBeNull();

    act(() => {
      void client.refetchQueries({ queryKey: ['probe'] });
    });
    flush();
    expect(screen.getByTestId('loading-bar')).toBeInTheDocument();
  });
});
