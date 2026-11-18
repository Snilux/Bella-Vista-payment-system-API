import { formatDateTime } from '@bella-vista/shared';
import { colors, statusColors } from '../ui/theme/index.js';

// The frame of the two PDF reports (RF-REP; 3.2 §11.1; D-26): HTML that expo-print turns into a
// PDF on the phone. Every text that comes from data goes through escapeHtml; the colors are the
// 2.4 tokens; dates are AAAA-MM-DD and amounts es-MX ($1,234.00).

/** Escapes the five HTML characters: a name like «López & <Hijos>» stays text. */
export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/** Who generated the PDF and when (3.2: fecha y hora de generación y el cargo). */
export type ReportMeta = { generatedAt: Date; generatedBy: string };

/** "2026-11-18 10:42" in the business time zone (formatDateTime, as on screen). */
export function generatedAtText(date: Date): string {
  return formatDateTime(date);
}

export type HtmlRow = { label: string; value: string };

/** A two-column table of label and amount. */
export function rowsTable(rows: readonly HtmlRow[], className = 'figures'): string {
  return `<table class="${className}">${rows
    .map(
      (row) =>
        `<tr><td>${escapeHtml(row.label)}</td><td class="amount">${escapeHtml(row.value)}</td></tr>`,
    )
    .join('')}</table>`;
}

export const tag = (label: string, tone: keyof typeof statusColors) =>
  `<span class="tag" style="color:${statusColors[tone].text};background:${statusColors[tone].background}">${escapeHtml(label)}</span>`;

const css = `
  * { box-sizing: border-box; }
  body { font-family: Inter, Helvetica, Arial, sans-serif; color: ${colors.text}; margin: 24px; font-size: 11pt; }
  header { background: ${colors.primaryStrong}; color: ${colors.onFill}; padding: 16px 20px; border-radius: 8px; }
  header h1 { margin: 0; font-size: 16pt; }
  header p { margin: 4px 0 0; }
  .meta { color: ${colors.textSecondary}; font-size: 9pt; margin: 8px 0 16px; }
  h2 { font-size: 13pt; margin: 20px 0 8px; color: ${colors.primaryStrong}; }
  h3 { font-size: 11pt; margin: 14px 0 6px; }
  table { width: 100%; border-collapse: collapse; }
  td, th { padding: 5px 8px; border-bottom: 1px solid ${colors.divider}; text-align: left; vertical-align: top; }
  th { color: ${colors.textSecondary}; font-weight: 600; font-size: 9pt; }
  .summary { background: ${colors.surfaceWarm}; border-radius: 8px; }
  .amount { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .tag { padding: 2px 6px; border-radius: 4px; font-size: 9pt; font-weight: 600; white-space: nowrap; }
  .muted { color: ${colors.textSecondary}; }
`;

/** The whole document: the committee header, the report title and who generated it. */
export function documentHtml(options: {
  title: string;
  subtitle: string;
  meta: ReportMeta;
  body: string;
}): string {
  return `<!DOCTYPE html><html lang="es-MX"><head><meta charset="utf-8"><title>${escapeHtml(
    options.title,
  )}</title><style>${css}</style></head><body>
<header><h1>Comité de Agua Bella Vista</h1><p>${escapeHtml(options.title)} · ${escapeHtml(
    options.subtitle,
  )}</p></header>
<p class="meta">Generado el ${escapeHtml(generatedAtText(options.meta.generatedAt))} por ${escapeHtml(
    options.meta.generatedBy,
  )}</p>
${options.body}
</body></html>`;
}
