import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app.tsx';
import { applyTheme, initialTheme } from './lib/theme.ts';
import './index.css';

// Before the first render, so the page never flashes the other theme.
applyTheme(initialTheme());

async function start() {
  // Only the demo build (`vite build --mode demo`) answers /api from the fixtures. In every other build this branch is
  // dead code, so the mock never reaches the bundle that `adrien serve` ships.
  if (import.meta.env.MODE === 'demo') {
    const { installDemoFetch } = await import('./lib/demo.ts');
    installDemoFetch(window);
  }

  const root = document.getElementById('root');
  if (!root) throw new Error('Missing #root element');

  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void start();
