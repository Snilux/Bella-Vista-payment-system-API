// Pay periods of the plumber (D-24, RF-GAS-08), by the frequency of the salary in force:
// weekly Monday to Sunday, biweekly from the 1st to the 15th and from the 16th to the last day,
// monthly the calendar month. Dates are calendar dates (YYYY-MM-DD) of the business time zone.

export type SalaryFrequency = 'weekly' | 'biweekly' | 'monthly';

export interface PayPeriod {
  start: string;
  end: string;
}

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function parse(date: string): Date {
  const match = DATE.exec(date);
  if (!match) throw new RangeError(`invalid date ${date}`);
  const value = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (value.toISOString().slice(0, 10) !== date) throw new RangeError(`invalid date ${date}`);
  return value;
}

const format = (date: Date) => date.toISOString().slice(0, 10);

const lastDayOfMonth = (year: number, month: number) =>
  new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

/** The pay period of `frequency` that contains `date`. */
export function plumberPayPeriod(frequency: SalaryFrequency, date: string): PayPeriod {
  const day = parse(date);
  const year = day.getUTCFullYear();
  const month = day.getUTCMonth();
  const pad = (n: number) => String(n).padStart(2, '0');
  const ym = `${year}-${pad(month + 1)}`;
  switch (frequency) {
    case 'weekly': {
      // getUTCDay: Sunday = 0; the week starts on Monday.
      const fromMonday = (day.getUTCDay() + 6) % 7;
      const start = new Date(day);
      start.setUTCDate(day.getUTCDate() - fromMonday);
      const end = new Date(start);
      end.setUTCDate(start.getUTCDate() + 6);
      return { start: format(start), end: format(end) };
    }
    case 'biweekly':
      return day.getUTCDate() <= 15
        ? { start: `${ym}-01`, end: `${ym}-15` }
        : { start: `${ym}-16`, end: `${ym}-${pad(lastDayOfMonth(year, month))}` };
    case 'monthly':
      return { start: `${ym}-01`, end: `${ym}-${pad(lastDayOfMonth(year, month))}` };
  }
}
