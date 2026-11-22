import { QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { HashRouter } from 'react-router';
import { IconSprite } from './components/icon.tsx';
import { createQueryClient } from './lib/queries.ts';
import { AppRoutes } from './routes.tsx';

/**
 * Hash routing (`#/adr/ADR-0001`): the build uses a relative base so the CLI can serve it from any folder, and with
 * history routing a reload of a nested route would ask for its assets under that route.
 */
export function App() {
  const [client] = useState(createQueryClient);
  return (
    <QueryClientProvider client={client}>
      <IconSprite />
      <HashRouter>
        <AppRoutes />
      </HashRouter>
    </QueryClientProvider>
  );
}
