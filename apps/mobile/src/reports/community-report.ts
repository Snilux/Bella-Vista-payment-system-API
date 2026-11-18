import { type CommunityReport, formatMoney as formatCents } from '@bella-vista/shared';
import {
  blockFigureRows,
  committeeRows,
  communitySummaryRows,
  rangeLabel,
  sectionTitle,
} from '../features/reports/report-view.js';
import { documentHtml, escapeHtml, type ReportMeta, rowsTable } from './html.js';

// Reporte comunitario (RF-REP-02; G-07): the same API response the screen shows, as HTML for
// the PDF.

export function communityReportHtml(report: CommunityReport, meta: ReportMeta): string {
  const sections = report.sections
    .map((section) => {
      const blocks = section.blocks
        .map(
          (block) =>
            `<h3>Manzana ${escapeHtml(block.code)}${
              block.leaderName ? ` · ${escapeHtml(block.leaderName)}` : ''
            }</h3>${rowsTable(blockFigureRows(block))}`,
        )
        .join('');
      return `<h2>${escapeHtml(sectionTitle(section))} · ${escapeHtml(section.name)}</h2>${rowsTable(
        blockFigureRows(section.totals),
        'figures summary',
      )}${blocks}`;
    })
    .join('');
  const support = report.supportCashboxes.length
    ? `<h2>Cajas de apoyo</h2>${report.supportCashboxes
        .map(
          (box) =>
            `<h3>${escapeHtml(box.label)}</h3>${rowsTable([
              { label: 'Cobrado', value: formatCents(box.collected) },
              { label: 'Entregado', value: formatCents(box.handedOver) },
              { label: 'Saldo', value: formatCents(box.balance) },
            ])}`,
        )
        .join('')}`
    : '';
  const body = `
<p class="muted">Periodo del ${escapeHtml(report.range.dateFrom)} al ${escapeHtml(report.range.dateTo)}.</p>
<h2>Resumen</h2>${rowsTable(communitySummaryRows(report), 'figures summary')}
<h2>Caja del comité</h2>${rowsTable(committeeRows(report))}
${sections}${support}`;
  return documentHtml({
    title: 'Reporte comunitario',
    subtitle: rangeLabel(report.range),
    meta,
    body,
  });
}
