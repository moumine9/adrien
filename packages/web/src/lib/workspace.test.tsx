import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { useWorkspace, useWorkspacePath, workspacePath } from './workspace.ts';

describe('workspacePath', () => {
  it('leaves the path alone when no workspace is in the URL', () => {
    expect(workspacePath(undefined, '/')).toBe('/');
    expect(workspacePath(undefined, '/adr/ADR-0001')).toBe('/adr/ADR-0001');
  });

  it('prefixes the path with /w/<name> when a workspace is in the URL', () => {
    expect(workspacePath('common', '/')).toBe('/w/common');
    expect(workspacePath('common', '/board')).toBe('/w/common/board');
    expect(workspacePath('common', '/adr/ADR-0001')).toBe('/w/common/adr/ADR-0001');
  });

  it('encodes the workspace name as one path segment', () => {
    expect(workspacePath('my log/x', '/graph')).toBe('/w/my%20log%2Fx/graph');
  });
});

function Probe() {
  const workspace = useWorkspace();
  const wp = useWorkspacePath();
  return <output data-testid="probe">{`${workspace ?? 'none'} ${wp('/board')}`}</output>;
}

describe('useWorkspace and useWorkspacePath', () => {
  it('read the workspace from the route', () => {
    render(
      <MemoryRouter initialEntries={['/w/common/board']}>
        <Routes>
          <Route path="w/:workspace">
            <Route path="board" element={<Probe />} />
          </Route>
          <Route path="board" element={<Probe />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByTestId('probe').textContent).toBe('common /w/common/board');
  });

  it('report no workspace on a flat route', () => {
    render(
      <MemoryRouter initialEntries={['/board']}>
        <Routes>
          <Route path="w/:workspace">
            <Route path="board" element={<Probe />} />
          </Route>
          <Route path="board" element={<Probe />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByTestId('probe').textContent).toBe('none /board');
  });
});
