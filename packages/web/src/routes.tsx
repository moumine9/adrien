import { lazy, type ReactElement } from 'react';
import { Route, Routes } from 'react-router';
import { Layout } from './components/layout.tsx';
import { FlatWorkspaceGate, NamedWorkspaceGate } from './components/workspace-gate.tsx';
import { BoardView } from './views/board-view.tsx';
import { DecisionsView } from './views/decisions-view.tsx';
import { FilesView } from './views/files-view.tsx';
import { HealthView } from './views/health-view.tsx';
import { NotFoundView } from './views/not-found-view.tsx';
import { SettingsView } from './views/settings-view.tsx';

// The detail (Markdown) and graph (d3-force) views load on demand, keeping the first page light.
const DecisionView = lazy(() => import('./views/decision-view.tsx').then((m) => ({ default: m.DecisionView })));
const GraphView = lazy(() => import('./views/graph-view.tsx').then((m) => ({ default: m.GraphView })));

/** The pages, one list shared by the flat routes and the `/w/:workspace` routes. */
function pageRoutes(): ReactElement[] {
  return [
    <Route key="index" index element={<DecisionsView />} />,
    <Route key="board" path="board" element={<BoardView />} />,
    <Route key="adr" path="adr/:id" element={<DecisionView />} />,
    <Route key="graph" path="graph" element={<GraphView />} />,
    <Route key="files" path="files" element={<FilesView />} />,
    <Route key="check" path="check" element={<HealthView />} />,
    <Route key="settings" path="settings" element={<SettingsView />} />,
    <Route key="not-found" path="*" element={<NotFoundView />} />,
  ];
}

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route element={<FlatWorkspaceGate />}>{pageRoutes()}</Route>
      </Route>
      <Route path="w/:workspace" element={<Layout />}>
        <Route element={<NamedWorkspaceGate />}>{pageRoutes()}</Route>
      </Route>
    </Routes>
  );
}
