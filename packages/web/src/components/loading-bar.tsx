import { useIsFetching } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

/** How long a shown bar stays up at least, so a fast answer still reads as a load. */
export const LOADING_BAR_MIN_MS = 400;

/**
 * A thin stripe along the bottom of the header while any query fetches. It is decorative: the first load announces
 * itself through the skeletons, and automatic refreshes stay silent.
 */
export function LoadingBar() {
  const fetching = useIsFetching() > 0;
  // `holding` keeps the bar up for LOADING_BAR_MIN_MS after it appeared, even when the answer arrives sooner.
  const [holding, setHolding] = useState(false);

  useEffect(() => {
    if (fetching) setHolding(true);
  }, [fetching]);

  useEffect(() => {
    if (!holding) return;
    const timer = setTimeout(() => setHolding(false), LOADING_BAR_MIN_MS);
    return () => clearTimeout(timer);
  }, [holding]);

  if (!fetching && !holding) return null;
  return <div aria-hidden="true" data-testid="loading-bar" className="loading-bar" />;
}
