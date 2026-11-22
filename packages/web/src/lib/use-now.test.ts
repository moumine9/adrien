import { act, renderHook } from '@testing-library/react';
import { NOW_TICK_MS, useNow } from './use-now.ts';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-22T12:00:00Z'));
});
afterEach(() => {
  vi.useRealTimers();
});

describe('useNow', () => {
  it('gives the current time and moves it forward on every tick', () => {
    const { result } = renderHook(() => useNow());
    const first = result.current;
    expect(first).toBe(Date.now());
    act(() => {
      vi.advanceTimersByTime(NOW_TICK_MS);
    });
    expect(result.current).toBe(first + NOW_TICK_MS);
  });

  it('shares one timer between all the components that use it', () => {
    const spy = vi.spyOn(globalThis, 'setInterval');
    const a = renderHook(() => useNow());
    const b = renderHook(() => useNow());
    expect(spy).toHaveBeenCalledTimes(1);
    a.unmount();
    b.unmount();
    spy.mockRestore();
  });

  it('stops its timer when the last component goes away, and starts again for the next one', () => {
    const clear = vi.spyOn(globalThis, 'clearInterval');
    const first = renderHook(() => useNow());
    first.unmount();
    expect(clear).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(10 * NOW_TICK_MS);
    const second = renderHook(() => useNow());
    expect(second.result.current).toBe(Date.now());
    second.unmount();
    clear.mockRestore();
  });
});
