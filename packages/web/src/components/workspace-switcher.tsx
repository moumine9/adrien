import { Link } from 'react-router';
import { useWorkspaces } from '@/lib/queries.ts';
import { useWorkspace } from '@/lib/workspace.ts';

/**
 * Names the workspace being read and leads back to the chooser. Shown only inside a workspace of a server that serves
 * several. A link, not a menu: a menu that navigates when its value changes moves a keyboard user away on the first
 * arrow key, and a form control under 16 px makes iOS zoom the page.
 */
export function WorkspaceSwitcher() {
  const { data } = useWorkspaces();
  const current = useWorkspace();
  if (!current || (data?.workspaces.length ?? 0) < 2) return null;
  return (
    <Link to="/" className="workspace-link" title="Choose another workspace">
      {`Workspace: ${current}`}
    </Link>
  );
}
