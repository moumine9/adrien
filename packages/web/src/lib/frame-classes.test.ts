import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const SRC = join(__dirname, '..');
const css = readFileSync(join(SRC, 'index.css'), 'utf8');

/** The source files of the app: not the tests, and not the vendored neobrutalism.dev components. */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return relative(SRC, path) === join('components', 'ui') ? [] : sourceFiles(path);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

describe('frame classes', () => {
  it.each(['frame', 'panel', 'notice', 'chip-frame', 'pill', 'hover-underline', 'focus-ring'])(
    'defines the %s utility',
    (name) => {
      expect(css).toMatch(new RegExp(`@utility ${name} \\{`));
    },
  );

  it('is used instead of repeating the frame, so a change to the frame is made in one place', () => {
    const repeated = sourceFiles(SRC).filter((file) =>
      readFileSync(file, 'utf8').includes('rounded-base border-2 border-border'),
    );
    expect(repeated.map((file) => relative(SRC, file))).toEqual([]);
  });

  it.each([
    ['chip-frame', 'rounded-inset border-2 border-border bg-secondary-background'],
    ['pill', 'inline-flex items-center gap-2 chip-frame'],
    ['hover-underline', 'hover:underline hover:decoration-2'],
    ['focus-ring', 'focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-ring'],
  ])('uses %s instead of repeating its classes', (_name, classes) => {
    const repeated = sourceFiles(SRC).filter((file) => readFileSync(file, 'utf8').includes(classes));
    expect(repeated.map((file) => relative(SRC, file))).toEqual([]);
  });

  it('focus-ring sets the outline style back to solid, because outline-none leaves it at none and hides the ring', () => {
    const rule = css.match(/@utility focus-ring \{[^}]*\}/)?.[0] ?? '';
    expect(rule).toContain('focus-visible:outline-solid');
  });
});
