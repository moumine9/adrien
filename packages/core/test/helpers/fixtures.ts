import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { onTestFinished } from 'vitest';
import YAML from 'yaml';
import { DEFAULT_TAGS, type LogConfig } from '../../src/config.ts';
import { BODY_TEMPLATE, serializeAdr } from '../../src/frontmatter.ts';
import type { AdrMeta } from '../../src/model.ts';

/** A fresh temp dir (real path, so it compares equal to what git reports), removed after the test. */
export function tmpDir(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'adrien-')));
  try {
    onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
  } catch {
    // called outside a test (e.g. beforeAll): the OS temp dir cleans up eventually
  }
  return dir;
}

export function writeFiles(root: string, files: Record<string, string>): void {
  for (const [rel, text] of Object.entries(files)) {
    const full = join(root, ...rel.split('/'));
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, text);
  }
}

export function adrText(meta: Partial<AdrMeta> & { id: string; title: string }, body = BODY_TEMPLATE): string {
  return serializeAdr({
    body,
    meta: {
      status: 'proposed',
      tags: [],
      components: [],
      code: [],
      sources: [],
      supersedes: [],
      related: [],
      deciders: [],
      origin: 'manual',
      contested: false,
      extra: {},
      ...meta,
    },
  });
}

export const DEFAULT_COMPONENTS: LogConfig['components'] = {
  'billing-service': { repo: 'https://gitlab.example.com/acme/billing-service' },
  web: { repo: '.', root: 'apps/web' },
};

export function configYaml(over: Partial<LogConfig> = {}): string {
  return YAML.stringify({
    product: 'acme',
    adr_dir: 'docs/adr',
    id_format: 'ADR-{n:4}',
    tags: DEFAULT_TAGS,
    components: DEFAULT_COMPONENTS,
    ...over,
  });
}
