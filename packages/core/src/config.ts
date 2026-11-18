import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import YAML from 'yaml';
import { z } from 'zod';
import { AdrienError } from './errors.ts';
import { parseIdFormat } from './ids.ts';
import { TEMPLATE_NAMES, type TemplateName } from './model.ts';

export const CONFIG_FILE = 'adrien.config.yaml';
export const CODE_CONFIG_FILE = '.adrien.yaml';
export const DEFAULT_TAGS = ['frontend', 'backend', 'database', 'infra', 'security'];

/** `repo: '.'` means the component lives in the same repo as the log. */
export interface ComponentDef {
  repo?: string;
  root?: string;
}

export interface LogConfig {
  product: string;
  /** Body skeleton for new ADRs. Default `standard`. */
  template?: TemplateName;
  adr_dir: string;
  id_format: string;
  tags: string[];
  components: Record<string, ComponentDef>;
  /** `adrien lint`: markdownlint rule settings, merged over Adrien's defaults. */
  lint?: { markdownlint: Record<string, unknown> };
}

export interface CodeRepoConfig {
  log: string;
  components?: string[];
}

const ID = /^[a-z0-9][a-z0-9._-]*$/;
const idMessage = 'must be lowercase letters, digits, ".", "_" or "-" (no ":")';

const componentDef = z.preprocess(
  (v) => v ?? {},
  z.strictObject({ repo: z.string().min(1).optional(), root: z.string().optional() }),
);

const logConfigSchema = z.strictObject({
  product: z.string().min(1),
  adr_dir: z.string().min(1).default('docs/adr'),
  id_format: z.string().default('ADR-{n:4}'),
  template: z.enum(TEMPLATE_NAMES).default('standard'),
  tags: z.array(z.string().regex(ID, idMessage)).default([]),
  components: z.record(z.string(), componentDef).default({}),
  lint: z.strictObject({ markdownlint: z.record(z.string(), z.unknown()).default({}) }).optional(),
});

const codeRepoSchema = z.strictObject({
  log: z.string().min(1),
  components: z.array(z.string().regex(ID, idMessage)).optional(),
});

function readYamlFile(file: string): unknown {
  try {
    return YAML.parse(readFileSync(file, 'utf8')) ?? {};
  } catch (e) {
    throw new AdrienError('CONFIG_INVALID', `${file}: invalid YAML (${(e as Error).message.split('\n')[0]})`);
  }
}

function validate<T>(schema: z.ZodType<T>, data: unknown, file: string): T {
  const parsed = schema.safeParse(data);
  if (parsed.success) return parsed.data;
  const issue = parsed.error.issues[0];
  throw new AdrienError('CONFIG_INVALID', `${file}: ${issue?.path.join('.') || 'config'}: ${issue?.message}`);
}

export function loadLogConfig(logRoot: string): LogConfig {
  const file = join(logRoot, CONFIG_FILE);
  if (!existsSync(file)) throw new AdrienError('CONFIG_NOT_FOUND', `No ${CONFIG_FILE} in ${logRoot}`);
  const config = validate(logConfigSchema, readYamlFile(file), file);
  for (const id of Object.keys(config.components)) {
    if (!ID.test(id)) throw new AdrienError('CONFIG_INVALID', `${file}: component "${id}" ${idMessage}`);
  }
  parseIdFormat(config.id_format);
  return config;
}

function writeNew(file: string, data: unknown): void {
  if (existsSync(file)) throw new AdrienError('CONFIG_EXISTS', `${file} already exists`);
  writeFileSync(file, YAML.stringify(data));
}

export function writeLogConfig(logRoot: string, config: LogConfig): void {
  writeNew(join(logRoot, CONFIG_FILE), config);
}

export function loadCodeRepoConfig(dir: string): CodeRepoConfig | null {
  const file = join(dir, CODE_CONFIG_FILE);
  return existsSync(file) ? validate(codeRepoSchema, readYamlFile(file), file) : null;
}

export function writeCodeRepoConfig(dir: string, config: CodeRepoConfig): void {
  writeNew(join(dir, CODE_CONFIG_FILE), config);
}

/** The closest directory at or above `startDir` that contains `fileName`. */
export function findUp(startDir: string, fileName: string): string | null {
  let dir = resolve(startDir);
  for (;;) {
    if (existsSync(join(dir, fileName))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}
