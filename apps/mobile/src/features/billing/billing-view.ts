import {
  comparePeriods,
  formatMoney,
  formatPeriod,
  type Period,
  type SelectableMonth,
} from '@bella-vista/shared';
import type { StatusTone } from '../../ui/index.js';

// How the billing screens say things (3.2 §10.2, §10.3; 2.4 §7). Nothing here decides whether a
// month is overdue or how much surcharge it carries: the account statement (API) or the shared
// domain says it; this only turns it into words.

type Tag = { tone: StatusTone; label: string };

/** The tag of a month of the statement or of F-02. */
export function monthTag(month: {
  status: 'pending' | 'overdue' | 'paid' | 'advance';
  surcharge: number | null;
}): Tag {
  switch (month.status) {
    case 'overdue':
      return (month.surcharge ?? 0) > 0
        ? { tone: 'surcharge', label: 'Recargo' }
        : { tone: 'overdue', label: 'Vencido' };
    case 'pending':
      return { tone: 'pending', label: 'Pendiente' };
    case 'paid':
      return { tone: 'paid', label: 'Pagado' };
    case 'advance':
      return { tone: 'advance', label: 'Anticipo' };
  }
}

/** F-02: the tag of a selectable month (an advance is not paid yet: "Adelanto"). */
export function selectableTag(month: SelectableMonth): Tag {
  if (month.kind === 'advance') return { tone: 'advance', label: 'Adelanto' };
  return monthTag({ status: month.kind, surcharge: month.surcharge });
}

/** "$50.00 + recargo $50.00", or just "$50.00". */
export function breakdown(month: { baseAmount: number; surcharge: number }): string {
  return month.surcharge > 0
    ? `${formatMoney(month.baseAmount)} + recargo ${formatMoney(month.surcharge)}`
    : formatMoney(month.baseAmount);
}

const monthName = (period: Period) => (formatPeriod(period).split(' ')[0] ?? '').toLowerCase();
const yearOf = (period: Period) => period.slice(0, 4);

/**
 * The months of a payment in words, as on the paper receipt: "Junio 2026", "Junio y julio
 * 2026", "Junio a septiembre 2026", "Diciembre 2026 y enero 2027", "Noviembre 2026 a febrero
 * 2027". The months of a payment are always consecutive (D-03).
 */
export function monthsSummary(periods: readonly Period[]): string {
  const sorted = [...periods].sort(comparePeriods);
  const first = sorted[0];
  const last = sorted.at(-1);
  if (!first || !last) return '';
  if (sorted.length === 1) return formatPeriod(first);
  const joiner = sorted.length === 2 ? ' y ' : ' a ';
  if (yearOf(first) === yearOf(last)) {
    const text = `${monthName(first)}${joiner}${monthName(last)} ${yearOf(last)}`;
    return text.charAt(0).toUpperCase() + text.slice(1);
  }
  return `${formatPeriod(first)}${joiner}${formatPeriod(last).toLowerCase()}`;
}

/** F-03 "Tarifa": "$50.00 por mes" when every month has the same base, else null. */
export function uniformRate(months: readonly { baseAmount: number }[]): string | null {
  const [first, ...rest] = months;
  if (!first || rest.some((month) => month.baseAmount !== first.baseAmount)) return null;
  return `${formatMoney(first.baseAmount)} por mes`;
}

/** F-02: the notice over the months, from the statement's summary. */
export function overdueNotice(summary: {
  overdueCount: number;
  inDebtCycle: boolean;
}): string | null {
  if (summary.overdueCount === 0) return null;
  const months =
    summary.overdueCount === 1
      ? 'Tiene 1 mes vencido.'
      : `Tiene ${summary.overdueCount} meses vencidos.`;
  return summary.inDebtCycle ? `${months} Cada mes vencido paga doble.` : months;
}

/** F-02 bottom bar: "Total (2 meses)". */
export function totalLabel(months: number, charges: number): string {
  const parts = [
    months > 0 ? (months === 1 ? '1 mes' : `${months} meses`) : null,
    charges > 0 ? (charges === 1 ? '1 concepto' : `${charges} conceptos`) : null,
  ].filter(Boolean);
  return parts.length > 0 ? `Total (${parts.join(' y ')})` : 'Total';
}

/** F-03 and G-10: why the button is disabled while the paper folio is empty. */
export const MISSING_FOLIO = 'Escriba el folio del recibo de papel.';
