import { render, screen } from '@testing-library/react';
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
      <AdrMarkdown source={'See [the queue](ADR-0007-send-notifications.md) and [x](./ADR-0002-db.md#context).'} />,
    );
    expect(screen.getByRole('link', { name: 'the queue' })).toHaveAttribute('href', '#/adr/ADR-0007');
    expect(screen.getByRole('link', { name: 'x' })).toHaveAttribute('href', '#/adr/ADR-0002');
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
    expect(adrUrlTransform('ADR-0012-cap.md')).toBe('#/adr/ADR-0012');
    expect(adrUrlTransform('javascript:alert(1)')).toBe('');
  });
});
