import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import type { Adr, Status } from './model.ts';
import { loadSqlite } from './sqlite.ts';
import type { LogView, PendingChange } from './view.ts';

export interface AdrRow {
  id: string;
  title: string;
  status: Status;
  tags: string[];
  components: string[];
  review_rule: string | null;
  layer: 'base' | 'pending';
  pending_kind: PendingChange['kind'] | null;
  path: string;
}

/** `tags`: a row must have ALL of them; `components` and `status`: ANY; `layer` defaults to 'all'. */
export interface Filters {
  tags?: string[];
  components?: string[];
  status?: Status[];
  layer?: 'base' | 'pending' | 'all';
}

export interface SyncStats {
  inserted: number;
  updated: number;
  deleted: number;
  unchanged: number;
}

const SCHEMA_VERSION = 1;

const SCHEMA = `
  CREATE TABLE docs (
    layer TEXT NOT NULL, path TEXT NOT NULL, hash TEXT NOT NULL,
    id TEXT NOT NULL, title TEXT NOT NULL, status TEXT NOT NULL,
    tags TEXT NOT NULL, components TEXT NOT NULL, review_rule TEXT, pending_kind TEXT,
    PRIMARY KEY (layer, path)
  );
  CREATE VIRTUAL TABLE adr_fts USING fts5(
    layer UNINDEXED, path UNINDEXED, title, review_rule, body,
    tokenize = 'unicode61 remove_diacritics 2'
  );`;

const ROW_COLUMNS =
  'docs.id, docs.title, docs.status, docs.tags, docs.components, docs.review_rule, docs.layer, docs.pending_kind, docs.path';

interface Doc {
  layer: 'base' | 'pending';
  adr: Adr;
  kind: PendingChange['kind'] | null;
}

/** Turns free text into a safe FTS5 query: every letter/digit run becomes a quoted prefix term. */
export function toFtsQuery(input: string): string | null {
  const tokens = input.match(/[\p{L}\p{N}]+/gu);
  return tokens ? tokens.map((t) => `"${t}"*`).join(' ') : null;
}

function docsOf(view: LogView): Doc[] {
  const docs: Doc[] = view.base.map((adr) => ({ layer: 'base', adr, kind: null }));
  for (const change of view.pending) {
    const adr = change.kind === 'deleted' ? change.base : change.current;
    if (adr) docs.push({ layer: 'pending', adr, kind: change.kind });
  }
  return docs;
}

const hashOf = (doc: Doc): string =>
  createHash('sha1')
    .update(JSON.stringify([doc.adr.meta, doc.adr.body, doc.adr.path, doc.kind]))
    .digest('hex');

function whereClause(filters: Filters): { sql: string; params: SQLInputValue[] } {
  const parts: string[] = [];
  const params: SQLInputValue[] = [];
  const marks = (values: unknown[]) => values.map(() => '?').join(', ');
  if (filters.layer && filters.layer !== 'all') {
    parts.push('docs.layer = ?');
    params.push(filters.layer);
  }
  if (filters.status?.length) {
    parts.push(`docs.status IN (${marks(filters.status)})`);
    params.push(...filters.status);
  }
  if (filters.tags?.length) {
    const tags = [...new Set(filters.tags)];
    parts.push(`(SELECT count(DISTINCT value) FROM json_each(docs.tags) WHERE value IN (${marks(tags)})) = ?`);
    params.push(...tags, tags.length);
  }
  if (filters.components?.length) {
    parts.push(`EXISTS (SELECT 1 FROM json_each(docs.components) WHERE value IN (${marks(filters.components)}))`);
    params.push(...filters.components);
  }
  return { sql: parts.length ? ` AND ${parts.join(' AND ')}` : '', params };
}

function toRow(r: Record<string, SQLInputValue>): AdrRow {
  return {
    id: String(r.id),
    title: String(r.title),
    status: r.status as Status,
    tags: JSON.parse(String(r.tags)),
    components: JSON.parse(String(r.components)),
    review_rule: r.review_rule == null ? null : String(r.review_rule),
    layer: r.layer as AdrRow['layer'],
    pending_kind: (r.pending_kind ?? null) as AdrRow['pending_kind'],
    path: String(r.path),
  };
}

/** A per-log SQLite cache of the ADRs, rebuilt incrementally from the markdown. Never committed. */
export class AdrIndex {
  private constructor(private readonly db: DatabaseSync) {}

  static async open(logRoot: string): Promise<AdrIndex> {
    const { DatabaseSync } = await loadSqlite();
    const dir = join(logRoot, '.adrien');
    mkdirSync(dir, { recursive: true });
    const gitignore = join(dir, '.gitignore');
    if (!existsSync(gitignore)) writeFileSync(gitignore, '*\n');
    const db = new DatabaseSync(join(dir, 'index.db'));
    const version = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
    if (version !== SCHEMA_VERSION) {
      db.exec('DROP TABLE IF EXISTS docs; DROP TABLE IF EXISTS adr_fts;');
      db.exec(SCHEMA);
      db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
    }
    return new AdrIndex(db);
  }

  sync(view: LogView): SyncStats {
    const stats: SyncStats = { inserted: 0, updated: 0, deleted: 0, unchanged: 0 };
    const existing = new Map(
      (
        this.db.prepare('SELECT layer, path, hash FROM docs').all() as Array<{
          layer: string;
          path: string;
          hash: string;
        }>
      ).map((r) => [`${r.layer}\0${r.path}`, r.hash]),
    );
    const insertDoc = this.db.prepare(
      'INSERT INTO docs (layer, path, hash, id, title, status, tags, components, review_rule, pending_kind) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    );
    const insertFts = this.db.prepare(
      'INSERT INTO adr_fts (layer, path, title, review_rule, body) VALUES (?, ?, ?, ?, ?)',
    );
    const remove = (layer: string, path: string) => {
      this.db.prepare('DELETE FROM docs WHERE layer = ? AND path = ?').run(layer, path);
      this.db.prepare('DELETE FROM adr_fts WHERE layer = ? AND path = ?').run(layer, path);
    };

    this.db.exec('BEGIN');
    try {
      for (const doc of docsOf(view)) {
        const key = `${doc.layer}\0${doc.adr.path}`;
        const hash = hashOf(doc);
        const previous = existing.get(key);
        existing.delete(key);
        if (previous === hash) {
          stats.unchanged++;
          continue;
        }
        if (previous === undefined) stats.inserted++;
        else {
          stats.updated++;
          remove(doc.layer, doc.adr.path);
        }
        const { meta, body, path } = doc.adr;
        insertDoc.run(
          doc.layer,
          path,
          hash,
          meta.id,
          meta.title,
          meta.status,
          JSON.stringify(meta.tags),
          JSON.stringify(meta.components),
          meta.review_rule ?? null,
          doc.kind,
        );
        insertFts.run(doc.layer, path, meta.title, meta.review_rule ?? '', body);
      }
      for (const key of existing.keys()) {
        const [layer = '', path = ''] = key.split('\0');
        remove(layer, path);
        stats.deleted++;
      }
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
    return stats;
  }

  list(filters: Filters = {}): AdrRow[] {
    const where = whereClause(filters);
    const rows = this.db
      .prepare(`SELECT ${ROW_COLUMNS} FROM docs WHERE 1 = 1${where.sql} ORDER BY docs.id, docs.layer, docs.path`)
      .all(...where.params);
    return rows.map(toRow);
  }

  search(query: string, filters: Filters = {}, limit = 20): AdrRow[] {
    const fts = toFtsQuery(query);
    if (!fts) return [];
    const where = whereClause(filters);
    const rows = this.db
      .prepare(
        `SELECT ${ROW_COLUMNS} FROM adr_fts JOIN docs ON docs.layer = adr_fts.layer AND docs.path = adr_fts.path
         WHERE adr_fts MATCH ?${where.sql} ORDER BY bm25(adr_fts, 0, 0, 5.0, 3.0, 1.0) LIMIT ?`,
      )
      .all(fts, ...where.params, limit);
    return rows.map(toRow);
  }

  close(): void {
    this.db.close();
  }
}
