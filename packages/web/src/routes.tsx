import { lazy } from 'react';
import { Route, Routes } from 'react-router';
import { Layout } from './components/layout.tsx';
import { BoardView } from './views/board-view.tsx';
import { DecisionsView } from './views/decisions-view.tsx';
import { FilesView } from './views/files-view.tsx';
import { HealthView } from './views/health-view.tsx';
import { NotFoundView } from './views/not-found-view.tsx';

// The detail (Markdown) and graph (d3-force) views load on demand, keeping the first page light.
const DecisionView = lazy(() => import('./views/decision-view.tsx').then((m) => ({ default: m.DecisionView })));
const GraphView = lazy(() => import('./views/graph-view.tsx').then((m) => ({ default: m.GraphView })));
const SettingsView = lazy(() => import('./views/settings-view.tsx').then((m) => ({ default: m.SettingsView })));

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<DecisionsView />} />
        <Route path="board" element={<BoardView />} />
        <Route path="adr/:id" element={<DecisionView />} />
        <Route path="graph" element={<GraphView />} />
        <Route path="files" element={<FilesView />} />
        <Route path="check" element={<HealthView />} />
        <Route path="settings" element={<SettingsView />} />
        <Route path="*" element={<NotFoundView />} />
      </Route>
    </Routes>
  );
}
