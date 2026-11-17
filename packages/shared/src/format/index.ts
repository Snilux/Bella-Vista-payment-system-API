import { BUSINESS_TIME_ZONE } from '../domain/periods.js';

// es-MX formats for the texts users see (RNF-USA-02): amounts as $1,234.00, periods as
// "Junio 2026" and dates as "25 oct 2026". Pure functions, used by the API messages and the app.

const MONTHS = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre',
] as const;

const money = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Integer cents → "$1,234.00" (negative amounts as "-$50.00"). */
export function formatMoney(cents: number): string {
  if (!Number.isInteger(cents)) throw new RangeError(`amount ${cents} is not in whole cents`);
  const sign = cents < 0 ? '-' : '';
  return `${sign}$${money.format(Math.abs(cents) / 100)}`;
}

/**
 * Amount typed by a person (pesos) → integer cents, or null when it is not a valid amount.
 * Accepts "1234", "1,234.5", "$ 1,234.50" and ".5"; rejects negatives, more than two decimals,
 * misplaced commas and anything else. It works on the digits as text, never with decimals, so
 * "0.1" is exactly 10 cents.
 */
export function parseMoney(text: string): number | null {
  const compact = text.replace(/\s/g, '').replace(/^\$/, '');
  if (compact === '' || compact === '.') return null;
  const match = /^(\d{1,3}(?:,\d{3})+|\d+)?(?:\.(\d{0,2}))?$/.exec(compact);
  if (!match) return null;
  const pesos = (match[1] ?? '0').replace(/,/g, '');
  const cents = Number(pesos) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
  return Number.isSafeInteger(cents) ? cents : null;
}

/** Period AAAA-MM → "Junio 2026". */
export function formatPeriod(period: string): string {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(period);
  if (!match) throw new RangeError(`invalid period ${period}`);
  return `${MONTHS[Number(match[2]) - 1]} ${match[1]}`;
}

const SHORT_MONTHS = [
  'ene',
  'feb',
  'mar',
  'abr',
  'may',
  'jun',
  'jul',
  'ago',
  'sep',
  'oct',
  'nov',
  'dic',
] as const;

const DATE = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/** Calendar date YYYY-MM-DD → "25 oct 2026". */
export function formatDate(date: string): string {
  const match = DATE.exec(date);
  if (!match) throw new RangeError(`invalid date ${date}`);
  return `${Number(match[3])} ${SHORT_MONTHS[Number(match[2]) - 1]} ${match[1]}`;
}

/**
 * Instant (ISO timestamp or Date) → "25 oct 2026, 10:42", on the clock of the business time zone
 * (America/Mexico_City by default), 24-hour.
 */
export function formatDateTime(instant: string | Date, timeZone = BUSINESS_TIME_ZONE): string {
  const value = typeof instant === 'string' ? new Date(instant) : instant;
  if (Number.isNaN(value.getTime())) throw new RangeError(`invalid instant ${String(instant)}`);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '';
  const date = formatDate(`${part('year')}-${part('month')}-${part('day')}`);
  return `${date}, ${part('hour')}:${part('minute')}`;
}
