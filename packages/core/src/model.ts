import { z } from 'zod';

export const STATUSES = ['proposed', 'accepted', 'rejected', 'superseded', 'deprecated'] as const;
export type Status = (typeof STATUSES)[number];

/** Body skeletons `adrien new` can start from. `standard` is Adrien's own; `madr` follows MADR 4's section names. */
export const TEMPLATE_NAMES = ['standard', 'minimal', 'madr'] as const;
export type TemplateName = (typeof TEMPLATE_NAMES)[number];

export const ORIGINS = ['manual', 'agent', 'mined'] as const;
export type Origin = (typeof ORIGINS)[number];

export interface AdrMeta {
  id: string;
  title: string;
  status: Status;
  date?: string;
  /** `YYYY-MM-DD`: when this decision is due to be looked at again. `check` warns once it passes. */
  review_on?: string;
  tags: string[];
  components: string[];
  code: string[];
  review_rule?: string;
  sources: string[];
  supersedes: string[];
  superseded_by?: string;
  related: string[];
  /** Common decisions this one departs from, each a `workspace/ADR-n` reference. Exempts the files it covers (ADR-0035). */
  exception_to: string[];
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
  /** A short hash of the text this ADR was parsed from, to base a change on. Set when an ADR is loaded from a file. */
  revision?: string;
}

/** The frontmatter keys Adrien owns, in the order they are written. */
export const META_KEYS = [
  'id',
  'title',
  'status',
  'date',
  'review_on',
  'tags',
  'components',
  'code',
  'review_rule',
  'sources',
  'supersedes',
  'superseded_by',
  'related',
  'exception_to',
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
  review_on: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'must be a date like 2027-03-04')
    .optional(),
  tags: stringList,
  components: stringList,
  code: stringList,
  review_rule: z.string().optional(),
  sources: stringList,
  supersedes: stringList,
  superseded_by: z.string().optional(),
  related: stringList,
  exception_to: stringList,
  deciders: stringList,
  origin: z.enum(ORIGINS).default('manual'),
  contested: z.boolean().default(false),
});
