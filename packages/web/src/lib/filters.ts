import type { Status } from '@adrien/api/contract';
import { STATUS_ORDER } from './status.ts';

/** The decision list filters. They live in the URL query string so a filtered view can be shared. */
export interface DecisionFilters {
  q: string;
  status: Status[];
  tag: string[];
  component: string[];
  pending: boolean;
}

export const EMPTY_FILTERS: DecisionFilters = { q: '', status: [], tag: [], component: [], pending: false };

const unique = (values: string[]): string[] => [...new Set(values.map((v) => v.trim()).filter(Boolean))];

const isStatus = (v: string): v is Status => (STATUS_ORDER as readonly string[]).includes(v);

export function filtersFromSearch(params: URLSearchParams): DecisionFilters {
  const pending = params.get('pending');
  return {
    q: (params.get('q') ?? '').trim(),
    status: unique(params.getAll('status')).filter(isStatus),
    tag: unique(params.getAll('tag')),
    component: unique(params.getAll('component')),
    pending: pending === '1' || pending === 'true',
  };
}

/** Same keys as the API, with values sorted so the same view always has the same URL. */
export function filtersToSearch(f: DecisionFilters): URLSearchParams {
  const out = new URLSearchParams();
  const q = f.q.trim();
  if (q) out.set('q', q);
  for (const key of ['status', 'tag', 'component'] as const) {
    for (const v of [...unique(f[key])].sort()) out.append(key, v);
  }
  if (f.pending) out.set('pending', '1');
  return out;
}

/** The query for `GET /api/adrs`: the URL parameters are already the API's. */
export function toApiQuery(f: DecisionFilters): URLSearchParams {
  return filtersToSearch(f);
}

export function toggle<T>(list: readonly T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

/** Chips and the pending switch; the search box shows itself. */
export function activeFilterCount(f: DecisionFilters): number {
  return f.status.length + f.tag.length + f.component.length + (f.pending ? 1 : 0);
}

/** File paths typed or pasted one per line (or separated by commas), trimmed and de-duplicated. */
export function parsePaths(input: string): string[] {
  return unique(input.split(/[\n,]/));
}
