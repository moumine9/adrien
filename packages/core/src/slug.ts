const MAX_SLUG = 60;

export function normalizeTitle(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function slugify(s: string): string {
  return normalizeTitle(s).replace(/ /g, '-').slice(0, MAX_SLUG).replace(/-+$/, '');
}
