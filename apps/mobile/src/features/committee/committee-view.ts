import {
  type Expense,
  formatDate,
  formatMoney,
  type PlumberDetail,
  type PlumberSalary,
  plumberPayPeriod,
} from '@bella-vista/shared';
import type { StatusTone } from '../../ui/index.js';

// Texts and rules of the committee screens (T-04 to T-09; D-17, D-21, D-24). Pure functions.

export const EXPENSE_TAGS: Record<Expense['status'], { tone: StatusTone; label: string }> = {
  pending_payment: { tone: 'pending', label: 'Pendiente' },
  paid: { tone: 'paid', label: 'Pagado' },
  rejected: { tone: 'cancelled', label: 'Rechazado' },
  refunded: { tone: 'cancelled', label: 'Reintegrado' },
};

/**
 * T-06 and T-07: why paying is blocked (2.4: a disabled button says why), or null. An expense is
 * paid from the committee cashbox only with enough balance (RF-GAS-04).
 */
export function payBlockedReason(amount: number | null, balance: number | null): string | null {
  if (amount === null || balance === null || amount <= balance) return null;
  return `No hay saldo suficiente: la caja del comité tiene ${formatMoney(balance)} y el gasto es de ${formatMoney(amount)}. Guárdelo como pendiente y páguelo cuando haya saldo.`;
}

/** T-07: what paying leaves in the committee cashbox. */
export const afterPayingNotice = (amount: number, balance: number): string =>
  `Al pagarlo se descuenta de la caja del comité. Quedarán ${formatMoney(balance - amount)}.`;

/** T-06: the second step of "Guardar y pagar" failed for lack of balance. */
export const SAVED_NOT_PAID =
  'El gasto quedó registrado y pendiente de pago: no hay saldo suficiente.';

// --- Plumber --------------------------------------------------------------------------------

export const FREQUENCY_LABELS: Record<PlumberSalary['frequency'], string> = {
  weekly: 'Semanal',
  biweekly: 'Quincenal',
  monthly: 'Mensual',
};

const MONTHS = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
] as const;

const day = (date: string) => Number(date.slice(8, 10));

/** T-08 rows: "1 al 15 oct 2026" (or "28 sep 2026 al 4 oct 2026" across months). */
export function payPeriodShort(start: string, end: string): string {
  return start.slice(0, 7) === end.slice(0, 7)
    ? `${day(start)} al ${formatDate(end)}`
    : `${formatDate(start)} al ${formatDate(end)}`;
}

/** T-09 selector: "16 al 31 de octubre 2026". */
export function payPeriodLong(start: string, end: string): string {
  if (start.slice(0, 7) !== end.slice(0, 7)) return payPeriodShort(start, end);
  const month = MONTHS[Number(start.slice(5, 7)) - 1] ?? '';
  return `${day(start)} al ${day(end)} de ${month} ${start.slice(0, 4)}`;
}

/** The authorized salary in force on `date` (the latest effectiveFrom on or before it). */
export function salaryOn(salaries: readonly PlumberSalary[], date: string): PlumberSalary | null {
  return (
    salaries
      .filter((salary) => salary.status === 'approved' && salary.effectiveFrom <= date)
      .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0] ?? null
  );
}

export type PayablePeriod = { start: string; end: string; salary: PlumberSalary };

const dayBefore = (date: string) => {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() - 1);
  return value.toISOString().slice(0, 10);
};

/**
 * T-09: the periods that can still be paid, newest first: the one of today and the previous
 * ones with an authorized salary, without those already paid (a period is paid once, D-24).
 * The frequency of each period is that of the salary in force on its day, as in the API.
 */
export function payablePeriods(
  plumber: Pick<PlumberDetail, 'salaries' | 'payments'>,
  today: string,
  count = 6,
): PayablePeriod[] {
  // Like the API: any payment of a period takes it, even a refunded one.
  const paid = new Set(plumber.payments.map((payment) => payment.periodStart));
  const periods: PayablePeriod[] = [];
  let cursor = today;
  // Walks back period by period; it stops where no salary was in force.
  for (let step = 0; step < count * 4 && periods.length < count; step += 1) {
    const atDay = salaryOn(plumber.salaries, cursor);
    if (!atDay) break;
    const period = plumberPayPeriod(atDay.frequency, cursor);
    const salary = salaryOn(plumber.salaries, period.start);
    if (!salary) break;
    if (!paid.has(period.start)) periods.push({ ...period, salary });
    cursor = dayBefore(period.start);
  }
  return periods;
}
