import {
  type BlockReport,
  type CommunityReport,
  formatMoney,
  formatPeriod,
} from '@bella-vista/shared';
import type { StatusTone } from '../../ui/index.js';

// The rows of the two reports (RF-REP-01, RF-REP-02), from the API's response as is. The screen
// (G-06, G-07) and the PDF templates (src/reports) paint these same rows, so the figures of the
// PDF are always the ones on the screen.

export type Row = { label: string; value: string };

type Range = BlockReport['range'];

/** "Octubre 2026" or "Agosto a octubre 2026". */
export function rangeLabel(range: Pick<Range, 'from' | 'to'>): string {
  if (range.from === range.to) return formatPeriod(range.from);
  const from = formatPeriod(range.from);
  const to = formatPeriod(range.to);
  return range.from.slice(0, 4) === range.to.slice(0, 4)
    ? `${from.split(' ')[0]} a ${to.toLowerCase()}`
    : `${from} a ${to.toLowerCase()}`;
}

const money = formatMoney;

// --- Block registry report (G-06) ---------------------------------------------------------

export function blockSummaryRows(report: BlockReport): Row[] {
  return [
    { label: 'Familias activas', value: String(report.totals.activeUnits) },
    { label: 'Cobrado en el periodo', value: money(report.totals.collected) },
    { label: 'Adeudo total', value: money(report.totals.totalDue) },
    { label: 'Anticipos', value: money(report.totals.advances) },
    { label: 'Debe tener el jefe', value: money(report.cashbox.expectedBalance) },
  ];
}

export function blockCashboxRows(report: BlockReport): Row[] {
  const box = report.cashbox;
  const rows: Row[] = [
    {
      label: 'Saldo inicial',
      value: box.openingBalance === null ? 'Sin capturar' : money(box.openingBalance),
    },
    { label: 'Mensualidades cobradas', value: money(box.collectedFees) },
    { label: 'Otros conceptos cobrados', value: money(box.collectedCharges) },
    { label: 'Cancelaciones', value: money(box.cancellations) },
    { label: 'Entregado al tesorero', value: money(box.handedOver) },
    { label: 'Entregas por confirmar', value: money(box.pendingHandover) },
    { label: 'Saldo esperado', value: money(box.expectedBalance) },
  ];
  if (box.lastClosing) {
    rows.push({
      label: 'Último corte',
      value: `${box.lastClosing.folio} (${box.lastClosing.dateFrom} a ${box.lastClosing.dateTo})${
        box.lastClosing.difference ? ` · diferencia ${money(box.lastClosing.difference)}` : ''
      }`,
    });
  }
  return rows;
}

type Unit = BlockReport['connections'][number]['units'][number];

export type UnitRow = {
  title: string;
  detail: string;
  tag: { tone: StatusTone; label: string };
};

export function unitRow(unit: Unit): UnitRow {
  const holder = unit.holder
    ? `${unit.holder.fullName}${unit.holder.distinguishingNote ? ` (${unit.holder.distinguishingNote})` : ''}`
    : 'Sin titular';
  const receipts = unit.payments
    .filter((payment) => !payment.cancelled && payment.paperFolio)
    .map((payment) => payment.paperFolio);
  const parts = [
    unit.debt.totalDue > 0 ? `Debe ${money(unit.debt.totalDue)}` : null,
    receipts.length > 0 ? `Recibo ${receipts.join(', ')}` : null,
    unit.advances.length > 0 ? `${unit.advances.length} mes(es) adelantados` : null,
  ].filter(Boolean);
  const tag: UnitRow['tag'] =
    unit.status === 'suspended'
      ? { tone: 'cancelled', label: 'Suspendida' }
      : unit.status === 'deactivated'
        ? { tone: 'cancelled', label: 'De baja' }
        : unit.debt.inDebtCycle
          ? { tone: 'surcharge', label: 'Recargo' }
          : unit.debt.totalDue > 0
            ? { tone: 'overdue', label: 'Con adeudo' }
            : unit.advances.length > 0
              ? { tone: 'advance', label: 'Anticipo' }
              : { tone: 'paid', label: 'Al corriente' };
  return {
    title: `${unit.folio} · ${holder}`,
    detail: parts.length > 0 ? parts.join(' · ') : 'Sin movimientos en el periodo',
    tag,
  };
}

// --- Community report (G-07) --------------------------------------------------------------

export function communitySummaryRows(report: CommunityReport): Row[] {
  const totals = report.totals;
  const rows: Row[] = [
    { label: 'Recaudado en el periodo', value: money(totals.collected) },
    { label: 'Efectivo con jefes', value: money(totals.cashWithLeaders) },
  ];
  if (totals.cashInSupport !== 0) {
    rows.push({ label: 'Cajas de apoyo', value: money(totals.cashInSupport) });
  }
  rows.push(
    { label: 'Caja del comité', value: money(totals.committeeBalance) },
    { label: 'Fondos comunitarios', value: money(totals.expectedCommunityFunds) },
    { label: 'Gastos del periodo', value: money(report.committee.expenses) },
    { label: 'Adeudo de familias', value: money(totals.totalDue) },
    { label: 'Anticipos', value: money(totals.advances) },
  );
  if (totals.closingDifferences !== 0) {
    rows.push({ label: 'Diferencias de cortes', value: money(totals.closingDifferences) });
  }
  return rows;
}

export function committeeRows(report: CommunityReport): Row[] {
  const c = report.committee;
  return [
    { label: 'Saldo inicial', value: money(c.openingBalance) },
    { label: 'Cobros directos', value: money(c.collected) },
    { label: 'Entregas recibidas', value: money(c.handoversReceived) },
    { label: 'Otros ingresos', value: money(c.incomes) },
    ...c.expensesByCategory.map((item) => ({
      label: `Gasto: ${item.name}`,
      value: money(-item.amount),
    })),
    { label: 'Reintegros', value: money(c.refunds) },
    { label: 'Aclaraciones', value: money(c.adjustments) },
    { label: 'Saldo de la caja', value: money(c.balance) },
  ];
}

type Section = CommunityReport['sections'][number];

export const sectionTitle = (section: Section) =>
  `Sección ${section.code} · ${section.blocks.length === 1 ? '1 manzana' : `${section.blocks.length} manzanas`}`;

export function blockFigureRows(block: Section['blocks'][number] | Section['totals']): Row[] {
  return [
    { label: 'Familias activas', value: String(block.activeUnits) },
    { label: 'Recaudado', value: money(block.collected) },
    { label: 'Adeudo', value: money(block.totalDue) },
    { label: 'Anticipos', value: money(block.advances) },
    { label: 'Entregado', value: money(block.handedOver) },
    { label: 'Efectivo con el jefe', value: money(block.cashWithLeader) },
  ];
}
