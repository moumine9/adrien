import type { FileDecisions } from '@adrien/api/contract';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { FileResult } from './file-result.tsx';

const own = {
  id: 'ADR-0004',
  title: 'Own rule',
  status: 'accepted',
  binding: true,
  workspace: null,
  layer: 'base',
  pending_kind: null,
  match: 'component',
  anchor: null,
  review_rule: null,
  excerpt: '',
  exemption: null,
};
const common = { ...own, title: 'Shared rule', workspace: 'shared-co' };
const entry = {
  file: 'apps/web/src/a.ts',
  component: 'web',
  decisions: [own, common],
  nearby: [],
  nearby_omitted: 0,
} as unknown as FileDecisions;

function renderFile(hasNotes: boolean, hasCommonNotes: boolean) {
  return render(
    <MemoryRouter>
      <FileResult entry={entry} hasNotes={hasNotes} hasCommonNotes={hasCommonNotes} />
    </MemoryRouter>,
  );
}

function bindings(container: HTMLElement): (string | null)[] {
  return [...container.querySelectorAll('[data-binding]')].map((el) => el.getAttribute('data-binding'));
}

describe('FileResult', () => {
  it('a product note unverifies only the own rows; a common note only the common rows', () => {
    expect(bindings(renderFile(true, false).container)).toEqual(['unverified', 'binding']);
    expect(bindings(renderFile(false, true).container)).toEqual(['binding', 'unverified']);
    expect(bindings(renderFile(false, false).container)).toEqual(['binding', 'binding']);
  });

  it('renders the same id from two logs without a duplicate-key warning', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    renderFile(false, false);
    expect(screen.getAllByText('ADR-0004')).toHaveLength(2);
    expect(error.mock.calls.flat().join(' ')).not.toMatch(/same key|unique "key"/);
    error.mockRestore();
  });

  it('labels a common row with its workspace and does not link it into the product', () => {
    renderFile(false, false);
    expect(screen.getByText('[shared-co]')).toBeInTheDocument();
    expect(screen.getAllByRole('link')).toHaveLength(1);
  });

  it('a common decision an exception exempts says so, instead of calling itself a hint', () => {
    const exempt = { ...common, binding: false, exemption: { by: 'ADR-0012' } };
    const exemptEntry = { ...entry, decisions: [exempt] } as unknown as FileDecisions;
    render(
      <MemoryRouter>
        <FileResult entry={exemptEntry} hasNotes={false} hasCommonNotes={false} />
      </MemoryRouter>,
    );
    expect(screen.getByText(/Exempt by ADR-0012/)).toBeTruthy();
    expect(screen.queryByText('Hint only')).toBeNull();
  });

  it('an exception that governs a file without naming its component says so, not "its component"', () => {
    const exception = { ...own, id: 'ADR-0012', match: 'exception' };
    const exceptionEntry = { ...entry, decisions: [exception] } as unknown as FileDecisions;
    render(
      <MemoryRouter>
        <FileResult entry={exceptionEntry} hasNotes={false} hasCommonNotes={false} />
      </MemoryRouter>,
    );
    expect(screen.getByText(/exception to a common decision/i)).toBeTruthy();
    expect(screen.queryByText(/Matched by its component/)).toBeNull();
  });

  it('a file outside every component does not claim that no decision applies to it', () => {
    const outside = { ...entry, file: 'README.md', component: null, decisions: [] } as unknown as FileDecisions;
    render(
      <MemoryRouter>
        <FileResult entry={outside} hasNotes={false} hasCommonNotes={false} />
      </MemoryRouter>,
    );
    expect(screen.getByText(/outside every declared component/)).toBeTruthy();
    expect(screen.queryByText(/no decision applies/i)).toBeNull();
  });

  it('lists the decisions anchored elsewhere in the component apart, links only the own ones and counts the rest', () => {
    const nearbyEntry = {
      ...entry,
      decisions: [],
      nearby: [
        { id: 'ADR-0007', title: 'Store invoices in Postgres', workspace: null, anchors: ['web:src/invoices/**'] },
        { id: 'ADR-0009', title: 'Shared rule', workspace: 'shared-co', anchors: ['web:lib/**', 'web:tools/**'] },
      ],
      nearby_omitted: 4,
    } as unknown as FileDecisions;
    render(
      <MemoryRouter>
        <FileResult entry={nearbyEntry} hasNotes={false} hasCommonNotes={false} />
      </MemoryRouter>,
    );
    expect(screen.getByText('No decision governs this file.')).toBeTruthy();
    const section = screen.getByRole('region', { name: /anchored elsewhere/i });
    expect(section.textContent).toContain('not binding here');
    expect(screen.getByRole('link', { name: /ADR-0007 Store invoices in Postgres/ })).toBeTruthy();
    expect(screen.getAllByRole('link')).toHaveLength(1);
    expect(screen.getByText('[shared-co]')).toBeTruthy();
    expect(screen.getByText('web:lib/**, web:tools/**')).toBeTruthy();
    expect(screen.getByText(/4 more/)).toBeTruthy();
    expect(screen.queryByText('Hint only')).toBeNull();
  });
});
