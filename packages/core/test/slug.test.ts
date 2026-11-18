import { normalizeTitle, slugify } from '../src/slug.ts';

test('slugify strips accents and punctuation into a dashed slug', () => {
  expect(slugify('Dates de facture en `UTC`, pas en heure locale')).toBe('dates-de-facture-en-utc-pas-en-heure-locale');
});

test('normalizeTitle lowercases, strips diacritics and collapses separators', () => {
  expect(normalizeTitle('Élan  du-Code!')).toBe('elan du code');
});

test('slugify caps the length at 60 without a trailing dash', () => {
  expect(slugify('a'.repeat(80)).length).toBeLessThanOrEqual(60);
  expect(slugify(`${'word '.repeat(20)}`)).not.toMatch(/-$/);
});
