import { act, renderHook, screen } from '@testing-library/react';
import { renderApp } from '@/test/render.tsx';
import { refreshInterval, useRefreshInterval } from './queries.ts';
import { updateSettings } from './settings.ts';

beforeEach(() => {
  localStorage.clear();
});

describe('refreshInterval', () => {
  it('maps the setting to milliseconds, and 0 to no polling', () => {
    expect(refreshInterval(0)).toBe(false);
    expect(refreshInterval(5)).toBe(5_000);
    expect(refreshInterval(60)).toBe(60_000);
  });
});

describe('useRefreshInterval', () => {
  it('follows the refresh setting at once', () => {
    const { result } = renderHook(() => useRefreshInterval());
    expect(result.current).toBe(5_000);
    act(() => updateSettings({ refreshSeconds: 0 }));
    expect(result.current).toBe(false);
    act(() => updateSettings({ refreshSeconds: 15 }));
    expect(result.current).toBe(15_000);
  });
});

describe('query polling', () => {
  it('gives the page queries the setting as their interval, paused in background tabs', async () => {
    const { client } = renderApp('/');
    await screen.findByRole('link', { name: 'Decisions' });
    const meta = client.getQueryCache().find({ queryKey: ['meta'] });
    expect(meta?.observers[0]?.options.refetchInterval).toBe(5_000);
    expect(meta?.observers[0]?.options.refetchIntervalInBackground).toBe(false);
  });

  it('changes the interval of mounted queries when the setting changes', async () => {
    const { client } = renderApp('/');
    await screen.findByRole('link', { name: 'Decisions' });
    act(() => updateSettings({ refreshSeconds: 0 }));
    const meta = client.getQueryCache().find({ queryKey: ['meta'] });
    expect(meta?.observers[0]?.options.refetchInterval).toBe(false);
  });
});
