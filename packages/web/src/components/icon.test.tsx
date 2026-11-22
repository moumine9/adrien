import { render } from '@testing-library/react';
import { Chip } from './badges.tsx';
import { Icon, IconSprite } from './icon.tsx';

describe('Icon', () => {
  it('draws a shared symbol by reference instead of its own paths', () => {
    const { container } = render(<Icon name="tag" className="size-3.5" />);
    const svg = container.querySelector('svg') as SVGSVGElement;
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(svg).toHaveClass('size-3.5');
    const use = svg.querySelector('use') as SVGUseElement;
    expect(use).toHaveAttribute('href', '#icon-tag');
    expect(svg.querySelectorAll('path, circle')).toHaveLength(0);
  });

  it('keeps the stroke weight the caller asks for, and inherits colour from the text', () => {
    const { container } = render(<Icon name="box" strokeWidth={2.5} />);
    const svg = container.querySelector('svg') as SVGSVGElement;
    expect(svg).toHaveAttribute('stroke', 'currentColor');
    expect(svg).toHaveAttribute('fill', 'none');
    expect(svg).toHaveAttribute('stroke-width', '2.5');
  });
});

describe('Chip with a sprite icon', () => {
  it('draws the sprite icon beside its label', () => {
    const { container } = render(<Chip iconId="box">core</Chip>);
    expect(container.querySelector('use')).toHaveAttribute('href', '#icon-box');
    expect(container).toHaveTextContent('core');
  });
});

describe('IconSprite', () => {
  it('holds one symbol per icon, each with the drawing the Icon refers to', () => {
    const { container } = render(<IconSprite />);
    const sprite = container.querySelector('svg') as SVGSVGElement;
    expect(sprite).toHaveAttribute('aria-hidden', 'true');
    for (const name of ['tag', 'box']) {
      const symbol = sprite.querySelector(`symbol#icon-${name}`);
      expect(symbol).not.toBeNull();
      expect(symbol).toHaveAttribute('viewBox', '0 0 24 24');
      expect(symbol?.querySelector('path')).not.toBeNull();
    }
  });
});
