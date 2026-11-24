import type { AdrRow, Diagnostic, FileDecisions } from '@adrien/core';

export function formatRow(row: AdrRow): string {
  const pending = row.layer === 'pending' ? ` (pending: ${row.pending_kind})` : '';
  return `${row.id}  ${row.status.padEnd(10)}  ${row.tags.join(',')}  ${row.title}${pending}\n`;
}

export function formatFileDecisions(files: FileDecisions[]): string {
  const lines: string[] = [];
  for (const file of files) {
    lines.push(file.component ? `${file.file} [${file.component}]` : file.file);
    if (!file.component) lines.push('  (outside every linked component, so no decision can be found for it)');
    else if (file.decisions.length === 0) lines.push('  (no decision covers this file)');
    for (const d of file.decisions) {
      const label = d.exemption
        ? `EXEMPT (by ${d.exemption.by})`
        : d.binding
          ? 'BINDING'
          : d.layer === 'pending'
            ? `pending ${d.pending_kind}`
            : `hint (${d.status})`;
      const origin = d.workspace === null ? '' : `[${d.workspace}] `;
      lines.push(`  ${origin}${d.id} ${label} ${d.title}`);
      if (d.review_rule) lines.push(`    rule: ${d.review_rule}`);
    }
    if (file.nearby.length > 0) lines.push(`  nearby, anchored elsewhere in ${file.component} (not binding here):`);
    for (const n of file.nearby) {
      const origin = n.workspace === null ? '' : `[${n.workspace}] `;
      lines.push(`    ${origin}${n.id} ${n.title}  ${n.anchors.join(', ')}`);
    }
    if (file.nearby_omitted > 0) {
      lines.push(`    and ${file.nearby_omitted} more: adrien list --component ${file.component}`);
    }
  }
  return `${lines.join('\n')}\n`;
}

export function formatDiagnostic(d: Diagnostic): string {
  return `${[d.severity, d.code, d.id, d.path, d.message].filter(Boolean).join('  ')}\n`;
}
