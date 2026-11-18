import {
  activeFilterCount,
  EMPTY_FILTERS,
  filtersFromSearch,
  filtersToSearch,
  parsePaths,
  toApiQuery,
  toggle,
} from './filters.ts';

describe('filtersFromSearch', () => {
  it('reads every filter from the query string', () => {
    const f = filtersFromSearch(
      new URLSearchParams('q=retry&status=accepted&status=proposed&tag=security&component=billing-service&pending=1'),
    );
    expect(f).toEqual({
      q: 'retry',
      status: ['accepted', 'proposed'],
      tag: ['security'],
      component: ['billing-service'],
      pending: true,
    });
  });

  it('defaults to no filters', () => {
    expect(filtersFromSearch(new URLSearchParams(''))).toEqual(EMPTY_FILTERS);
  });

  it('drops unknown statuses, blanks and duplicates', () => {
    const f = filtersFromSearch(new URLSearchParams('status=accepted&status=nope&status=accepted&tag=&tag=a&tag=a'));
    expect(f.status).toEqual(['accepted']);
    expect(f.tag).toEqual(['a']);
  });

  it('only treats pending=1 or pending=true as on', () => {
    expect(filtersFromSearch(new URLSearchParams('pending=0')).pending).toBe(false);
    expect(filtersFromSearch(new URLSearchParams('pending=true')).pending).toBe(true);
  });
});

describe('filtersToSearch', () => {
  it('writes a stable, sorted query string and omits empty filters', () => {
    const s = filtersToSearch({
      q: '  cache  ',
      status: ['proposed', 'accepted'],
      tag: ['security', 'data'],
      component: [],
      pending: false,
    });
    expect(s.toString()).toBe('q=cache&status=accepted&status=proposed&tag=data&tag=security');
  });

  it('round-trips through filtersFromSearch', () => {
    const f = { q: 'a b', status: ['rejected' as const], tag: ['x'], component: ['y', 'z'], pending: true };
    expect(filtersFromSearch(filtersToSearch(f))).toEqual(f);
  });

  it('writes nothing for the empty filters', () => {
    expect(filtersToSearch(EMPTY_FILTERS).toString()).toBe('');
  });
});

describe('toApiQuery', () => {
  it('uses the API parameter names', () => {
    const q = toApiQuery({ q: 'x', status: ['accepted'], tag: ['t'], component: ['c'], pending: true });
    expect(q.getAll('status')).toEqual(['accepted']);
    expect(q.getAll('tag')).toEqual(['t']);
    expect(q.getAll('component')).toEqual(['c']);
    expect(q.get('pending')).toBe('1');
    expect(q.get('q')).toBe('x');
  });
});

describe('helpers', () => {
  it('toggles a value in a list', () => {
    expect(toggle(['a'], 'b')).toEqual(['a', 'b']);
    expect(toggle(['a', 'b'], 'a')).toEqual(['b']);
  });

  it('counts the active filters, search excluded', () => {
    expect(activeFilterCount(EMPTY_FILTERS)).toBe(0);
    expect(activeFilterCount({ q: 'x', status: ['accepted'], tag: ['a', 'b'], component: [], pending: true })).toBe(4);
  });

  it('splits pasted paths on new lines and commas', () => {
    expect(parsePaths(' src/a.ts\n\nsrc/b.ts, src/c.ts \nsrc/a.ts')).toEqual(['src/a.ts', 'src/b.ts', 'src/c.ts']);
    expect(parsePaths('   ')).toEqual([]);
  });
});
