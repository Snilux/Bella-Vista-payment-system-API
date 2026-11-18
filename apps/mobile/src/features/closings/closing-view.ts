import {
  type Closing,
  type ClosingFigures,
  formatMoney,
  formatPeriod,
  type Role,
} from '@bella-vista/shared';
import type { StatusTone } from '../../ui/index.js';

// Texts and rules of the closing screens (J-05, T-13, R-04, G-08; D-08, D-14). Pure functions:
// the figures are the API's (v_closing); the screens only paint them.

export const CLOSING_TAGS: Record<Closing['status'], { tone: StatusTone; label: string }> = {
  draft: { tone: 'pending', label: 'Borrador' },
  counted: { tone: 'pending', label: 'Contado' },
  reviewed: { tone: 'advance', label: 'Revisado' },
  closed: { tone: 'paid', label: 'Cerrado' },
};

/** "Corte de octubre 2026" or "Corte extraordinario al 2026-11-18". */
export function closingTitle(closing: Pick<Closing, 'type' | 'dateFrom' | 'dateTo'>): string {
  return closing.type === 'monthly'
    ? `Corte de ${formatPeriod(closing.dateFrom.slice(0, 7)).toLowerCase()}`
    : `Corte extraordinario al ${closing.dateTo}`;
}

/** The month name for the notice of G-08 ("…con fecha de octubre"). */
export const monthName = (period: string) =>
  formatPeriod(period).split(' ')[0]?.toLowerCase() ?? '';

export type FigureRow = { label: string; amount: number; signed: boolean };

/**
 * The rows of the closing card: the starting balance, every movement total that is not zero
 * (with its sign) and the expected balance ("Debe haber").
 */
export function figureRows(figures: ClosingFigures): FigureRow[] {
  const movements: [string, number][] = [
    ['Saldo inicial capturado', figures.openingBalances],
    ['Cobros', figures.payments],
    ['Cancelaciones', figures.cancellations],
    ['Entregas confirmadas', figures.handoversOut],
    ['Entregas recibidas', figures.handoversIn],
    ['Ingresos', figures.incomes],
    ['Gastos', figures.expenses],
    ['Reintegros', figures.refunds],
    ['Aclaraciones', figures.adjustments],
  ];
  return [
    { label: 'Saldo inicial', amount: figures.startingBalance, signed: false },
    ...movements
      .filter(([, amount]) => amount !== 0)
      .map(([label, amount]) => ({ label, amount, signed: true })),
  ];
}

/** +$1,950.00 / −$1,000.00 for the movement rows. */
export const signedMoney = (amount: number) =>
  amount > 0 ? `+${formatMoney(amount)}` : formatMoney(amount);

/** The difference of a count, in words: null while nothing is typed or it matches. */
export function countDifference(expected: number, counted: number | null): string | null {
  if (counted === null || counted === expected) return null;
  return counted < expected
    ? `Faltan ${formatMoney(expected - counted)}. Escriba una observación.`
    : `Sobran ${formatMoney(counted - expected)}. Escriba una observación.`;
}

/** The difference of a counted closing, for lists ("faltan $50.00", "sin diferencia"). */
export function differenceText(difference: number | null): string {
  if (difference === null) return 'Sin contar';
  if (difference === 0) return 'Sin diferencia';
  return difference < 0
    ? `Faltan ${formatMoney(-difference)}`
    : `Sobran ${formatMoney(difference)}`;
}

export type ClosingActions = { count: boolean; review: boolean; close: boolean };

/**
 * What the account may do with the closing (the API decides anyway): count, whoever prepared
 * it until it is reviewed; review, the president or the member once counted; close, only the
 * president once reviewed (M8: the member reviews but never closes). Closed: nothing.
 */
export function closingActions(
  closing: Pick<Closing, 'status' | 'preparedBy'>,
  account: { role: Role; username: string },
): ClosingActions {
  const preparer = closing.preparedBy.username === account.username;
  return {
    count: preparer && (closing.status === 'draft' || closing.status === 'counted'),
    review:
      closing.status === 'counted' && (account.role === 'president' || account.role === 'member'),
    close: closing.status === 'reviewed' && account.role === 'president',
  };
}

/** Months as options, newest first: from `last` back `count` months (AAAA-MM). */
export function periodOptions(last: string, count = 24): { value: string; label: string }[] {
  const [year = 0, month = 1] = last.split('-').map(Number);
  return Array.from({ length: count }, (_, back) => {
    const index = year * 12 + (month - 1) - back;
    const value = `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
    return { value, label: formatPeriod(value) };
  });
}

/** The month before `period` (AAAA-MM). */
export function previousPeriod(period: string): string {
  return periodOptions(period, 2)[1]?.value ?? period;
}
