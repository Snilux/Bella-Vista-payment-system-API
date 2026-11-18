import { BUSINESS_TIME_ZONE } from '@bella-vista/shared';

// Business dates of the forms (AAAA-MM-DD): "today" is the day in America/Mexico_City, the
// same the API uses, never the phone's UTC date.

export function businessToday(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

/** First name of a full name, for the greetings of the home screens ("Hola, Laura"). */
export const firstName = (fullName: string): string => fullName.trim().split(/\s+/)[0] ?? '';
