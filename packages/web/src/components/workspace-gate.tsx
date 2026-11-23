import { Outlet } from 'react-router';
import { useWorkspaces } from '@/lib/queries.ts';
import { useWorkspace } from '@/lib/workspace.ts';
import { WorkspaceNotFoundView } from '@/views/workspace-not-found-view.tsx';
import { WorkspacesView } from '@/views/workspaces-view.tsx';
import { LoadingBlocks } from './states.tsx';

/**
 * The flat routes (no `/w/` in the URL). With several workspaces the reader chooses one first; with one, or when the
 * list cannot be read, the page is shown as it always was, so a single-workspace log (and the static demo) is unchanged.
 */
export function FlatWorkspaceGate() {
  const { data, isPending } = useWorkspaces();
  if (isPending) return <LoadingBlocks label="Loading" count={2} />;
  if (data && data.workspaces.length > 1) return <WorkspacesView workspaces={data.workspaces} />;
  return <Outlet />;
}

/** The `/w/<name>` routes: a name the server does not serve gets a not-found page, once the list has loaded. */
export function NamedWorkspaceGate() {
  const workspace = useWorkspace() ?? '';
  const { data } = useWorkspaces();
  if (data && !data.workspaces.some((w) => w.name === workspace)) return <WorkspaceNotFoundView name={workspace} />;
  return <Outlet />;
}
