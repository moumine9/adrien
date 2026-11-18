import { parseAdr, serializeAdr } from '../src/frontmatter.ts';

const opts = { idFormat: 'ADR-{n:4}' };

test('empty frontmatter takes the number from the filename and status from a bullet', () => {
  const adr = parseAdr('---\n---\n# Storage\n* Status: Accepted\n', '2-storage.md', opts);
  expect(adr.meta).toMatchObject({ id: 'ADR-0002', title: 'Storage', status: 'accepted' });
  adr.meta.extra = { title: 'Conflicting title', owner: 'team' };
  expect(parseAdr(serializeAdr(adr), adr.path, opts).meta).toMatchObject({
    title: 'Storage',
    extra: { owner: 'team' },
  });
});

test.each(['42', '[a, b]'])('rejects non-mapping frontmatter %s', (yaml) => {
  expect(() => parseAdr(`---\n${yaml}\n---\n`, '1-a.md', opts)).toThrow('frontmatter must be a mapping');
});

test('requires an explicit id without a filename number', () => {
  expect(() => parseAdr('# Storage', 'storage.md', opts)).toThrow('no `id` in frontmatter');
});
