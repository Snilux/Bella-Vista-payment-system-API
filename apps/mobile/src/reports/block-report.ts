import type { BlockReport } from '@bella-vista/shared';
import {
  blockCashboxRows,
  blockSummaryRows,
  rangeLabel,
  unitRow,
} from '../features/reports/report-view.js';
import {
  documentHtml,
  escapeHtml,
  generatedAtText,
  type ReportMeta,
  rowsTable,
  tag,
} from './html.js';

// Reporte de padrón por manzana (RF-REP-01; G-06): the same API response the screen shows, as
// HTML for the PDF. Debts are those of the moment of the query (D-25).

export function blockReportHtml(report: BlockReport, meta: ReportMeta): string {
  const block = report.block;
  const leader = block.leader
    ? `Jefe de manzana: ${block.leader.fullName}${block.leader.phone ? ` · ${block.leader.phone}` : ''}`
    : 'Sin jefe de manzana';
  const connections = report.connections
    .map((connection) => {
      const units = connection.units
        .map((unit) => {
          const row = unitRow(unit);
          return `<tr><td>${escapeHtml(row.title)}<br><span class="muted">${escapeHtml(
            row.detail,
          )}</span></td><td class="amount">${tag(row.tag.label, row.tag.tone)}</td></tr>`;
        })
        .join('');
      return `<h3>Toma ${escapeHtml(connection.folio)} · ${escapeHtml(connection.address)}</h3><table>${
        units || '<tr><td class="muted">Sin familias</td><td></td></tr>'
      }</table>`;
    })
    .join('');
  const body = `
<p>Sección ${escapeHtml(block.section.code)} · ${escapeHtml(block.section.name)}<br>${escapeHtml(leader)}</p>
<p class="muted">Periodo del ${escapeHtml(report.range.dateFrom)} al ${escapeHtml(report.range.dateTo)}; adeudos al ${escapeHtml(
    generatedAtText(new Date(report.range.debtAsOf)).slice(0, 10),
  )}.</p>
<h2>Resumen</h2>${rowsTable(blockSummaryRows(report), 'figures summary')}
<h2>Caja de la manzana</h2>${rowsTable(blockCashboxRows(report))}
<h2>Tomas y familias</h2>${connections || '<p class="muted">Sin tomas registradas.</p>'}`;
  return documentHtml({
    title: `Padrón de la manzana ${block.code}`,
    subtitle: rangeLabel(report.range),
    meta,
    body,
  });
}
