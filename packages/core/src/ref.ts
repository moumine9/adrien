import { isWorkspaceName } from './config.ts';

/**
 * A reference to a decision: a plain id (`ADR-0004`), or `workspace/ADR-0004` for a decision of another log, where the
 * workspace is the target log's own name. A text with a `/` that is not such a reference keeps the whole text as its id
 * with no workspace, so the caller can report it.
 */
export interface Ref {
  workspace: string | null;
  id: string;
}

/** An id, as far as a reference can tell: the target log writes it in its own `id_format`, so only emptiness and spaces are refused. */
const REF_ID = /^\S+$/;

export function parseRef(text: string): Ref {
  const slash = text.indexOf('/');
  if (slash === -1) return { workspace: null, id: text };
  const workspace = text.slice(0, slash);
  const id = text.slice(slash + 1);
  if (!isWorkspaceName(workspace) || !REF_ID.test(id)) return { workspace: null, id: text };
  return { workspace, id };
}
