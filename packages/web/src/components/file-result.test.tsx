import type { FileDecisions } from '@adrien/api/contract';
import { render } from '@testing-library/react';
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
};
const common = { ...own, title: 'Shared rule', workspace: 'shared-co' };
const entry = { file: 'apps/web/src/a.ts', component: 'web', decisions: [own, common] } as unknown as FileDecisions;

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
});
