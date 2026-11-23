import type { WorkspacesResponse } from '@adrien/api/contract';
import { Link } from 'react-router';
import { PageHeader } from '@/components/states.tsx';
import { workspacePath } from '@/lib/workspace.ts';

/** The chooser at the flat routes, when the server serves several workspaces: one link per workspace. */
export function WorkspacesView({ workspaces }: { workspaces: WorkspacesResponse['workspaces'] }) {
  return (
    <div className="space-y-6">
      <PageHeader title="Choose a workspace">
        This server serves several workspaces. Pick one to read its decisions.
      </PageHeader>
      <ul className="grid gap-4 sm:grid-cols-2">
        {workspaces.map((workspace) => (
          <li key={workspace.name}>
            <Link to={workspacePath(workspace.name, '/')} className="workspace-card">
              <span className="font-heading text-lg">{workspace.name}</span>
              <span className="text-muted-foreground">{workspace.product}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
