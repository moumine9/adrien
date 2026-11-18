import type { Adr } from './model.ts';
import { normalizeTitle } from './slug.ts';

export interface DuplicateHit {
  id: string;
  title: string;
  score: number;
}

const THRESHOLD = 0.6;
const tokens = (title: string) =>
  new Set(
    normalizeTitle(title)
      .split(' ')
      .filter((t) => t.length >= 3),
  );

/** ADRs whose title is the same after normalisation (score 1) or shares most words (token Jaccard ≥ 0.6). */
export function findDuplicates(title: string, adrs: Adr[]): DuplicateHit[] {
  const wanted = normalizeTitle(title);
  const wantedTokens = tokens(title);
  const hits: DuplicateHit[] = [];
  const seen = new Set<string>();
  for (const adr of adrs) {
    if (seen.has(adr.meta.id)) continue;
    let score = 0;
    if (normalizeTitle(adr.meta.title) === wanted) score = 1;
    else {
      const other = tokens(adr.meta.title);
      const common = [...wantedTokens].filter((t) => other.has(t)).length;
      const union = new Set([...wantedTokens, ...other]).size;
      score = union ? common / union : 0;
    }
    if (score >= THRESHOLD) {
      seen.add(adr.meta.id);
      hits.push({ id: adr.meta.id, title: adr.meta.title, score: Math.round(score * 1000) / 1000 });
    }
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, 5);
}
