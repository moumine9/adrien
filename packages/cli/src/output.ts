import type { AdrRow, Diagnostic, FileDecisions } from '@adrien/core';

export function formatRow(row: AdrRow): string {
  const pending = row.layer === 'pending' ? ` (pending: ${row.pending_kind})` : '';
  return `${row.id}  ${row.status.padEnd(10)}  ${row.tags.join(',')}  ${row.title}${pending}\n`;
}

export function formatFileDecisions(files: FileDecisions[]): string {
  const lines: string[] = [];
  for (const file of files) {
    lines.push(file.component ? `${file.file} [${file.component}]` : file.file);
    if (!file.component) lines.push('  (not inside a linked component)');
    for (const d of file.decisions) {
      const label = d.binding ? 'BINDING' : d.layer === 'pending' ? `pending ${d.pending_kind}` : `hint (${d.status})`;
      lines.push(`  ${d.id} ${label} ${d.title}`);
      if (d.review_rule) lines.push(`    rule: ${d.review_rule}`);
    }
  }
  return `${lines.join('\n')}\n`;
}

export function formatDiagnostic(d: Diagnostic): string {
  return `${[d.severity, d.code, d.id, d.path, d.message].filter(Boolean).join('  ')}\n`;
}
