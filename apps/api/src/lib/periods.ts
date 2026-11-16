// Billing periods: the API speaks AAAA-MM (2.3); the database stores the first day of the
// month (CHECK extract(day) = 1).

/** '2026-11' → '2026-11-01'. */
export function periodToDate(period: string): string {
  return `${period}-01`;
}

/** '2026-11-01' → '2026-11'. */
export function dateToPeriod(date: string): string {
  return date.slice(0, 7);
}

/** Period (AAAA-MM) containing a date (YYYY-MM-DD). */
export function periodOf(date: string): string {
  return date.slice(0, 7);
}
