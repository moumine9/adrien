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

  it('keeps spacing off the 6, 10 and 14 px values', () => {
    const offScale = /\b(m|p|px|py|pt|pb|pl|pr|mx|my|mt|mb|ml|mr|gap|gap-x|gap-y|space-x|space-y)-(1\.5|2\.5|3\.5)\b/;
    const offending = sourceFiles(SRC).filter((file) => offScale.test(readFileSync(file, 'utf8')));
    expect(offending.map((file) => relative(SRC, file))).toEqual([]);
  });

  it('keeps spacing off the 12 px value, which sits between the 8 and 16 px steps', () => {
    const twelvePx =
      /(?<![\w-])-?(?:m|p|px|py|pt|pb|pl|pr|ps|pe|mx|my|mt|mb|ml|mr|ms|me|gap|gap-x|gap-y|space-x|space-y|inset|inset-x|inset-y|top|right|bottom|left)-3(?![\d.])/;
    const offending = sourceFiles(SRC).filter((file) => twelvePx.test(readFileSync(file, 'utf8')));
    expect(offending.map((file) => relative(SRC, file))).toEqual([]);
    expect(css).not.toMatch(twelvePx);
  });

  it('keeps spacing off the 2 px value', () => {
    const twoPx = /\b(m|p|px|py|pt|pb|pl|pr|mx|my|mt|mb|ml|mr|gap|gap-x|gap-y|space-x|space-y)-0\.5\b/;
    const offending = sourceFiles(SRC).filter((file) => twoPx.test(readFileSync(file, 'utf8')));
    expect(offending.map((file) => relative(SRC, file))).toEqual([]);
    expect(css).not.toMatch(twoPx);
  });

  it('dims the icon of a pill, because it sits beside text and must read below the text', () => {
    const rule = css.match(/@utility pill \{[^}]*\}/)?.[0] ?? '';
    expect(rule).toContain('[&_svg]:opacity-70');
  });
});

describe('icons, placeholders and radii in the shared UI', () => {
  it.each(['input', 'textarea'])('%s placeholder uses the muted foreground token, not half-opacity text', (name) => {
    const src = readFileSync(join(SRC, 'components', 'ui', `${name}.tsx`), 'utf8');
    expect(src).toContain('placeholder:text-muted-foreground');
    expect(src).not.toContain('placeholder:text-foreground/50');
  });

  it('graph legend swatches use the inset radius token, not a fixed 3 px', () => {
    const src = readFileSync(join(SRC, 'components', 'graph-legend.tsx'), 'utf8');
    expect(src).not.toContain('rounded-[3px]');
    expect(src.match(/rounded-inset/g)).toHaveLength(2);
  });

  it('badge icons are dimmed, as they sit beside text', () => {
    const src = readFileSync(join(SRC, 'components', 'ui', 'badge.tsx'), 'utf8');
    expect(src).toContain('[&>svg]:opacity-70');
  });

  it('toggle small text is 0.8125rem (13 px), not 0.8rem', () => {
    const src = readFileSync(join(SRC, 'components', 'ui', 'toggle.tsx'), 'utf8');
    expect(src).toContain('text-[0.8125rem]');
    expect(src).not.toContain('text-[0.8rem]');
  });

  it('button icons are dimmed only in the sizes that carry text, not in icon-only sizes', () => {
    const src = readFileSync(join(SRC, 'components', 'ui', 'button.tsx'), 'utf8');
    const sizes = src.slice(src.indexOf('size: {'), src.indexOf('defaultVariants'));
    const lineFor = (key: string) =>
      sizes.split('\n').find((line) => line.trim().replace(/['"]/g, '').startsWith(`${key}:`)) ?? '';
    for (const key of ['default', 'xs', 'sm', 'lg']) expect(lineFor(key)).toContain('[&_svg]:opacity-70');
    for (const key of ['icon', 'icon-xs', 'icon-sm', 'icon-lg']) expect(lineFor(key)).not.toContain('opacity-70');
  });
});

describe('layouts that must hold on narrow screens', () => {
  const read = (...parts: string[]) => readFileSync(join(SRC, ...parts), 'utf8');

  it('the main navigation wraps instead of scrolling, so no tab is cut at the screen edge', () => {
    const src = read('components', 'layout.tsx');
    const nav = src.slice(src.indexOf('<nav aria-label="Main"'), src.indexOf('</nav>'));
    expect(nav).not.toContain('overflow-x-auto');
    expect(nav).toContain('flex-wrap');
  });

  it('the approve summary grows with its label rather than clipping it in a fixed height', () => {
    const src = read('components', 'approve-disclosure.tsx');
    expect(src).toContain('min-h-10');
    expect(src).toContain('whitespace-nowrap');
    expect(src).not.toMatch(/<summary[^>]*(?<![\w-])h-10(?![\w-])/);
  });

  it('only the checkout badges, which have long labels, use the wrap-label utility', () => {
    const src = read('components', 'badges.tsx');
    const rule = css.slice(css.indexOf('@utility wrap-label'));
    const block = rule.slice(0, rule.indexOf('\n}\n'));
    expect(block).toContain('&[class]');
    expect(block).toContain('whitespace-normal');
    expect(block).toContain('max-w-full');
    expect(src).not.toContain('const wraps');
    for (const name of ['PendingBadge', 'LocalEditBadge', 'InCheckoutBadge']) {
      const body = src.slice(src.indexOf(`export function ${name}`));
      expect(body.slice(0, body.indexOf('\n}\n'))).toContain("cn(base, 'wrap-label',");
    }
    expect(src.match(/'wrap-label'/g)).toHaveLength(3);
    expect(src.match(/const base = '([^']*)'/)?.[1]).not.toContain('whitespace-normal');
  });
});
