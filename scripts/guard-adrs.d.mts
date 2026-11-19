export interface AdrChange {
  status: string;
  path: string;
  oldPath?: string;
  base?: string | null;
  head?: string | null;
}

export function guardChanges(input: { adrLabel: boolean; changes: AdrChange[] }): string[];
