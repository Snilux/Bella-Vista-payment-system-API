// es-MX formats for the texts users see (RNF-USA-02): amounts as $1,234.00 and periods as
// "Junio 2026". Pure functions, used by the API messages and later by the app.

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

/** Period AAAA-MM → "Junio 2026". */
export function formatPeriod(period: string): string {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(period);
  if (!match) throw new RangeError(`invalid period ${period}`);
  return `${MONTHS[Number(match[2]) - 1]} ${match[1]}`;
}
