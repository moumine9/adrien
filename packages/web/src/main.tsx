import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app.tsx';
import { applyTheme, initialTheme } from './lib/theme.ts';
import './index.css';

// Before the first render, so the page never flashes the other theme.
applyTheme(initialTheme());

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
