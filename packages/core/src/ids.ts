import { AdrienError } from './errors.ts';

export interface IdFormat {
  prefix: string;
  width: number;
  suffix: string;
}

/** Parses an id format such as `ADR-{n:4}`; `{n}` means no padding. */
export function parseIdFormat(fmt: string): IdFormat {
  const m = /^(.*)\{n(?::(\d+))?\}(.*)$/.exec(fmt);
  if (!m) throw new AdrienError('CONFIG_INVALID', `id_format "${fmt}" must contain {n} or {n:WIDTH}`);
  return { prefix: m[1] as string, width: m[2] ? Number(m[2]) : 1, suffix: m[3] as string };
}

export function formatId(n: number, fmt: string): string {
  const { prefix, width, suffix } = parseIdFormat(fmt);
  return `${prefix}${String(n).padStart(width, '0')}${suffix}`;
}

export function idNumber(id: string, fmt: string): number | null {
  const { prefix, suffix } = parseIdFormat(fmt);
  if (!id.startsWith(prefix) || !id.endsWith(suffix)) return null;
  const digits = id.slice(prefix.length, id.length - suffix.length);
  return /^\d+$/.test(digits) ? Number(digits) : null;
}

export function nextIdNumber(ids: string[], fmt: string): number {
  let max = 0;
  for (const id of ids) max = Math.max(max, idNumber(id, fmt) ?? 0);
  return max + 1;
}
