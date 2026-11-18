import { basename } from 'node:path';
import YAML, { visit } from 'yaml';
import { AdrienError } from './errors.ts';
import { formatId } from './ids.ts';
import { type Adr, type AdrMeta, adrMetaSchema, META_KEYS, STATUSES, type Status, type TemplateName } from './model.ts';

const TEMPLATES: Record<TemplateName, string[][]> = {
  standard: [['## Context'], ['## Considered options'], ['## Decision'], ['## Rationale'], ['## Consequences']],
  minimal: [['## Context'], ['## Decision'], ['## Consequences']],
  madr: [
    ['## Context and Problem Statement'],
    ['## Decision Drivers'],
    ['## Considered Options'],
    ['## Decision Outcome', '### Consequences', '### Confirmation'],
    ['## Pros and Cons of the Options'],
    ['## More Information'],
  ],
};

/** An empty skeleton: the headings only, each followed by a blank line, so it lints clean until it is filled in. */
export function bodyTemplate(name: TemplateName = 'standard'): string {
  return `\n${TEMPLATES[name].map((headings) => headings.join('\n\n')).join('\n\n')}\n`;
}

export const BODY_TEMPLATE = bodyTemplate('standard');

const FRONTMATTER = /^---\n([\s\S]*?\n)?---[ \t]*(?:\n|$)/;
const FILE_NUMBER = /^(?:ADR-)?(\d+)-/i;
const metaKeys: ReadonlySet<string> = new Set(META_KEYS);

function splitFrontmatter(text: string): { yaml: string | null; body: string } {
  const m = FRONTMATTER.exec(text);
  if (!m) return { yaml: null, body: text };
  return { yaml: m[1] ?? '', body: text.slice(m[0].length) };
}

/** `Superseded by [3. …](…)` → superseded; `Accepted` → accepted; anything else → null. */
function normalizeStatus(raw: string): Status | null {
  const s = raw.trim().toLowerCase();
  if (s.startsWith('superseded')) return 'superseded';
  const word = /^[a-z]+/.exec(s)?.[0];
  return word && (STATUSES as readonly string[]).includes(word) ? (word as Status) : null;
}

function statusFromBody(body: string): Status | null {
  const section = /^##\s+Status\s*\n+\s*(\S[^\n]*)/im.exec(body)?.[1];
  if (section) return normalizeStatus(section);
  const bullet = /^[*-]\s+Status:\s*(\S[^\n]*)/im.exec(body)?.[1];
  return bullet ? normalizeStatus(bullet) : null;
}

function titleFromBody(body: string): string | undefined {
  const h1 = /^#\s+(.+)$/m.exec(body)?.[1];
  return h1?.replace(/^\d+\.\s*/, '').trim();
}

function parseError(path: string, message: string): AdrienError {
  return new AdrienError('PARSE_ERROR', `${path}: ${message}`);
}

function readYaml(yaml: string, path: string): Record<string, unknown> {
  let data: unknown;
  try {
    data = YAML.parse(yaml);
  } catch (e) {
    throw parseError(path, `invalid YAML frontmatter (${(e as Error).message.split('\n')[0]})`);
  }
  if (data == null) return {};
  if (typeof data !== 'object' || Array.isArray(data)) throw parseError(path, 'frontmatter must be a mapping');
  return data as Record<string, unknown>;
}

export function parseAdr(text: string, path: string, opts: { idFormat: string }): Adr {
  const { yaml, body } = splitFrontmatter(text.replace(/\r\n/g, '\n'));
  const data = yaml === null ? {} : readYaml(yaml, path);

  const fileNumber = FILE_NUMBER.exec(basename(path))?.[1];
  const id = data.id ?? (fileNumber ? formatId(Number(fileNumber), opts.idFormat) : undefined);
  if (id === undefined) throw parseError(path, 'no `id` in frontmatter and no number in the file name');

  let status: Status | null = statusFromBody(body) ?? 'proposed';
  if (data.status !== undefined) {
    status = normalizeStatus(String(data.status));
    if (!status) throw parseError(path, `status "${String(data.status)}" must be one of ${STATUSES.join(', ')}`);
  }

  const known: Record<string, unknown> = {};
  const extra: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) (metaKeys.has(k) ? known : extra)[k] = v;

  const parsed = adrMetaSchema.safeParse({
    ...known,
    id: String(id),
    title: data.title ?? titleFromBody(body),
    status,
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw parseError(path, `${issue?.path.join('.')}: ${issue?.message}`);
  }
  const meta: AdrMeta = { ...parsed.data, extra };
  return { meta, body, path };
}

export function isAdrFile(text: string, fileName: string): boolean {
  if (FILE_NUMBER.test(fileName)) return true;
  const { yaml } = splitFrontmatter(text.replace(/\r\n/g, '\n'));
  return yaml !== null && /^id:\s*\S/m.test(yaml);
}

export function serializeAdr(adr: Pick<Adr, 'meta' | 'body'>): string {
  const { meta } = adr;
  const out: Record<string, unknown> = {};
  for (const key of META_KEYS) {
    const value = meta[key];
    if (value === undefined || (Array.isArray(value) && value.length === 0)) continue;
    if (key === 'origin' && value === 'manual') continue;
    if (key === 'contested' && value === false) continue;
    out[key] = value;
  }
  for (const [k, v] of Object.entries(meta.extra)) if (!(k in out)) out[k] = v;

  const doc = new YAML.Document(out);
  visit(doc, {
    Seq(_, node) {
      node.flow = true;
    },
  });
  return `---\n${doc.toString({ lineWidth: 0, flowCollectionPadding: false })}---\n${adr.body}`;
}
