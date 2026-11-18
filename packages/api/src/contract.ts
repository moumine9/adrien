/**
 * The JSON the local HTTP API returns (see docs/api.md). Types only: the web visualizer imports this file with
 * `import type`, so nothing from here reaches the browser bundle.
 */
import type { AdrMeta, AdrRow, Diagnostic, FileDecisions, Status } from '@adrien/core';

export type { AdrMeta, AdrRow, Diagnostic, FileDecisions, Status };

/** `GET /api/meta` */
export interface MetaResponse {
  version: string;
  product: string;
  adrDir: string;
  /** `git` when the log is read against a default branch, `files` when statuses are read as written. */
  mode: 'git' | 'files';
  baseRef: string | null;
  /** True when no default branch could be found (statuses unverified). */
  baseUnresolved: boolean;
  /** True when a shallow checkout shares no history with the default branch. */
  forkUnresolved: boolean;
  tags: string[];
  components: Record<string, { repo?: string; root?: string }>;
  counts: { total: number; pending: number; byStatus: Record<Status, number> };
}

/** `GET /api/adrs` */
export interface AdrsResponse {
  results: AdrRow[];
}

export interface AdrFile {
  meta: AdrMeta;
  body: string;
  /** Posix path relative to the log root. */
  path: string;
}

/** `GET /api/adrs/:id` */
export interface AdrResponse {
  id: string;
  /** The binding version on the default branch (null for an ADR that only exists in this checkout). */
  base: AdrFile | null;
  /** The difference in this checkout, never binding. `deleted` carries no file. */
  pending: ({ kind: 'added' | 'modified' | 'deleted' } & Partial<AdrFile>) | null;
}

export interface GraphNode {
  id: string;
  title: string;
  status: Status;
  tags: string[];
  /** True when the ADR exists only as a pending change in this checkout. */
  pending: boolean;
}

export interface GraphEdge {
  from: string;
  to: string;
  /** `supersedes`: from replaces to. `related`: a plain link. */
  type: 'supersedes' | 'related';
}

/** `GET /api/graph` */
export interface GraphResponse {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/** `GET /api/for?path=…` */
export interface ForResponse {
  files: FileDecisions[];
  /** Present when decisions are shown as binding without a default branch to verify against. */
  notes?: string[];
}

/** `GET /api/check` */
export interface CheckResponse {
  errors: number;
  warnings: number;
  diagnostics: Diagnostic[];
}

/** Every non-2xx response. */
export interface ApiError {
  error: { code: string; message: string };
}
