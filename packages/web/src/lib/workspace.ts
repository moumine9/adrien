import { useCallback } from 'react';
import { useParams } from 'react-router';

/** The workspace named in the URL (`/w/<name>/...`), or undefined on the flat routes. */
export function useWorkspace(): string | undefined {
  return useParams().workspace;
}

/** An app path (`/`, `/board`, `/adr/ADR-0001`) as the current URL needs it: under `/w/<name>` when one is open. */
export function workspacePath(workspace: string | undefined, path: string): string {
  if (workspace === undefined) return path;
  const base = `/w/${encodeURIComponent(workspace)}`;
  return path === '/' ? base : `${base}${path}`;
}

/** Turns an app path into the link for the workspace the reader is in. */
export function useWorkspacePath(): (path: string) => string {
  const workspace = useWorkspace();
  return useCallback((path: string) => workspacePath(workspace, path), [workspace]);
}
