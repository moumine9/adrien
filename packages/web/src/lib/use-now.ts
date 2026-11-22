import { useSyncExternalStore } from 'react';

/** How often the shared clock ticks. Relative times read in minutes, so half a minute keeps them within a tick of right. */
export const NOW_TICK_MS = 30_000;

let now = Date.now();
let timer: ReturnType<typeof setInterval> | undefined;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) {
    now = Date.now();
    timer = setInterval(() => {
      now = Date.now();
      for (const notify of listeners) notify();
    }, NOW_TICK_MS);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) clearInterval(timer);
  };
}

const getNow = () => now;

/** The current time in milliseconds, refreshed every `NOW_TICK_MS` by one timer shared by every component that uses it. */
export function useNow(): number {
  return useSyncExternalStore(subscribe, getNow, getNow);
}
