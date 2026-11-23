import { afterEach, vi } from 'vitest';

// A test that switches to fake timers gets the real ones back, even when it fails before cleaning up.
afterEach(() => {
  vi.useRealTimers();
});
