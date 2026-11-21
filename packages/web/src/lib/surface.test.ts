import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { contrastRatio } from './status.ts';
import { surfaceTraits } from './surface.ts';

const indexCss = readFileSync(join(import.meta.dirname, '../index.css'), 'utf8');

describe('surfaceTraits', () => {
  it('draws a binding decision solid, raised, with its status edge', () => {
    expect(surfaceTraits('binding', false)).toEqual({
      border: 'solid',
      shadow: 'solid',
      band: false,
      notch: false,
      statusEdge: true,
      reducedInk: false,
    });
  });

  it('draws an unverified decision like a binding one, but with a dashed shadow and a notch, and no edge', () => {
    expect(surfaceTraits('unverified', false)).toEqual({
      border: 'solid',
      shadow: 'dashed',
      band: false,
      notch: true,
      statusEdge: false,
      reducedInk: false,
    });
  });

  it('draws a pending change with a dashed border, a shadow and a hatched band', () => {
    expect(surfaceTraits('pending', false)).toEqual({
      border: 'dashed',
      shadow: 'solid',
      band: true,
      notch: false,
      statusEdge: false,
      reducedInk: false,
    });
  });

  it('draws a decision that is not binding solid and raised, with no edge', () => {
    expect(surfaceTraits('not-binding', false)).toEqual({
      border: 'solid',
      shadow: 'solid',
      band: false,
      notch: false,
      statusEdge: false,
      reducedInk: false,
    });
  });

  it('lowers the ink of a retired decision and changes nothing else about how it is drawn', () => {
    expect(surfaceTraits('not-binding', true)).toEqual({ ...surfaceTraits('not-binding', false), reducedInk: true });
    expect(surfaceTraits('pending', true)).toEqual({ ...surfaceTraits('pending', false), reducedInk: true });
  });
});

/** The value of a custom property inside the first block that starts with `selector`. */
function token(selector: string, name: string): string {
  const start = indexCss.indexOf(`${selector} {`);
  const block = indexCss.slice(start, indexCss.indexOf('}', start));
  const match = new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`).exec(block);
  if (!match) throw new Error(`${name} not found in ${selector}`);
  return match[1] as string;
}

describe('reduced ink', () => {
  it.each([
    [':root', 'light'],
    ['.dark', 'dark'],
  ])('keeps the muted ink of a retired decision readable on a card in the %s theme (%s)', (selector) => {
    const ratio = contrastRatio(token(selector, '--muted-foreground'), token(selector, '--secondary-background'));
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });
});
