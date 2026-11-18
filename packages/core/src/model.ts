import { z } from 'zod';

export const STATUSES = ['proposed', 'accepted', 'rejected', 'superseded', 'deprecated'] as const;
export type Status = (typeof STATUSES)[number];

export const ORIGINS = ['manual', 'agent', 'mined'] as const;
export type Origin = (typeof ORIGINS)[number];

export interface AdrMeta {
  id: string;
  title: string;
  status: Status;
  date?: string;
  tags: string[];
  components: string[];
  code: string[];
  review_rule?: string;
  sources: string[];
  supersedes: string[];
  superseded_by?: string;
  related: string[];
  deciders: string[];
  origin: Origin;
  contested: boolean;
  /** Frontmatter keys Adrien does not know, preserved in their original order. */
  extra: Record<string, unknown>;
}

export interface Adr {
  meta: AdrMeta;
  body: string;
  /** Posix path relative to the log root. */
  path: string;
}

/** The frontmatter keys Adrien owns, in the order they are written. */
export const META_KEYS = [
  'id',
  'title',
  'status',
  'date',
  'tags',
  'components',
  'code',
  'review_rule',
  'sources',
  'supersedes',
  'superseded_by',
  'related',
  'deciders',
  'origin',
  'contested',
] as const;

const stringList = z.array(z.string()).default([]);

export const adrMetaSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  status: z.enum(STATUSES),
  date: z.string().optional(),
  tags: stringList,
  components: stringList,
  code: stringList,
  review_rule: z.string().optional(),
  sources: stringList,
  supersedes: stringList,
  superseded_by: z.string().optional(),
  related: stringList,
  deciders: stringList,
  origin: z.enum(ORIGINS).default('manual'),
  contested: z.boolean().default(false),
});
