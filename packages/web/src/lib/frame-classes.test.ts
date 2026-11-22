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
  it.each(['frame', 'panel', 'notice'])('defines the %s utility', (name) => {
    expect(css).toMatch(new RegExp(`@utility ${name} \\{`));
  });

  it('is used instead of repeating the frame, so a change to the frame is made in one place', () => {
    const repeated = sourceFiles(SRC).filter((file) =>
      readFileSync(file, 'utf8').includes('rounded-base border-2 border-border'),
    );
    expect(repeated.map((file) => relative(SRC, file))).toEqual([]);
  });
});
