import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AdrMarkdown, adrUrlTransform } from './markdown.tsx';

describe('AdrMarkdown', () => {
  it('renders GitHub-flavoured Markdown: headings, tables, task lists', () => {
    const { container } = render(
      <AdrMarkdown source={'## Decision\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n- [x] done\n- [ ] todo'} />,
    );
    expect(screen.getByRole('heading', { name: 'Decision' })).toBeInTheDocument();
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(container.querySelectorAll('input[type="checkbox"]')).toHaveLength(2);
  });

  it('never renders raw HTML from the ADR', () => {
    const { container } = render(
      <AdrMarkdown
        source={
          'Hello <script>alert(1)</script> <img src="x" onerror="alert(2)"> <b>bold</b>\n\n<div onclick="x()">block</div>'
        }
      />,
    );
    expect(container.querySelector('script, img, b, div[onclick]')).toBeNull();
    expect(container.innerHTML).not.toContain('onerror');
    expect(container.innerHTML).not.toContain('onclick');
  });

  it('drops javascript: and other unsafe link targets', () => {
    const { container } = render(
      <AdrMarkdown
        source={'[a](javascript:alert(1)) [b](JAVASCRIPT:alert(1)) [c](data:text/html,x) [d](vbscript:x)'}
      />,
    );
    for (const a of container.querySelectorAll('a')) {
      expect(a.getAttribute('href') ?? '').not.toMatch(/^(javascript|data|vbscript):/i);
    }
  });

  it('opens links to other ADR files inside the app', () => {
    render(
      <AdrMarkdown
        source={'See [the queue](ADR-0007-send-notifications.md) and [x](./ADR-0002-db.md#context).'}
        resolveFile={(name) => ({ 'ADR-0007-send-notifications.md': 'ADR-0007', 'ADR-0002-db.md': 'ADR-0002' })[name]}
      />,
    );
    expect(screen.getByRole('link', { name: 'the queue' })).toHaveAttribute('href', '#/adr/ADR-0007');
    expect(screen.getByRole('link', { name: 'x' })).toHaveAttribute('href', '#/adr/ADR-0002');
  });

  it("resolves links with the log's real ids, whatever its id format", () => {
    const files = new Map([
      ['DEC-0001-ARCH-some-title.md', 'DEC-0001-ARCH'],
      ['0003-use-postgres.md', '0003'],
    ]);
    render(
      <AdrMarkdown
        source={'[a](DEC-0001-ARCH-some-title.md) [b](../old/0003-use-postgres.md#why) [c](0009-unknown.md)'}
        resolveFile={(name) => files.get(name)}
      />,
    );
    expect(screen.getByRole('link', { name: 'a' })).toHaveAttribute('href', '#/adr/DEC-0001-ARCH');
    expect(screen.getByRole('link', { name: 'b' })).toHaveAttribute('href', '#/adr/0003');
    expect(screen.getByRole('link', { name: 'c' })).toHaveAttribute('href', '0009-unknown.md');
  });

  it('scrolls to a same-page heading without replacing the routing hash', async () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    window.location.hash = '#/adr/ADR-0001';
    render(<AdrMarkdown source={'[jump](#considered-options)\n\n## Considered options\n\ntext'} />);
    await userEvent.click(screen.getByRole('link', { name: 'jump' }));
    expect(window.location.hash).toBe('#/adr/ADR-0001');
    expect(scroll).toHaveBeenCalledTimes(1);
    expect(scroll.mock.contexts[0]).toBe(screen.getByRole('heading', { name: 'Considered options' }));
  });

  it('opens external links in a new tab without an opener', () => {
    render(<AdrMarkdown source={'[docs](https://example.com/a)'} />);
    const link = screen.getByRole('link', { name: /docs/ });
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });
});

describe('adrUrlTransform', () => {
  it('keeps safe URLs and rewrites ADR files', () => {
    expect(adrUrlTransform('https://example.com')).toBe('https://example.com');
    expect(adrUrlTransform('#section')).toBe('#section');
    expect(adrUrlTransform('ADR-0012-cap.md', (name) => (name === 'ADR-0012-cap.md' ? 'ADR-0012' : undefined))).toBe(
      '#/adr/ADR-0012',
    );
    expect(adrUrlTransform('ADR-0012-cap.md')).toBe('ADR-0012-cap.md');
    // A file of the same name elsewhere is not the local decision.
    const resolve = () => 'ADR-0012';
    expect(adrUrlTransform('https://github.com/x/y/blob/main/ADR-0012-cap.md', resolve)).toBe(
      'https://github.com/x/y/blob/main/ADR-0012-cap.md',
    );
    expect(adrUrlTransform('//example.com/ADR-0012-cap.md', resolve)).toBe('//example.com/ADR-0012-cap.md');
    expect(adrUrlTransform('javascript:alert(1)')).toBe('');
  });

  it('keeps the workspace in a link to another decision', () => {
    const resolve = (name: string) => (name === 'ADR-0012-cap.md' ? 'ADR-0012' : undefined);
    expect(adrUrlTransform('ADR-0012-cap.md', resolve, 'common')).toBe('#/w/common/adr/ADR-0012');
    expect(adrUrlTransform('https://example.com', resolve, 'common')).toBe('https://example.com');
  });
});
