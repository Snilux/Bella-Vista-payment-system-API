import { formatDateInWords } from '@bella-vista/shared';
import { useState } from 'react';
import { TextField } from './TextField.js';

// Campo de fecha (3.2 §11.2; approved for every date of M4 to M6): text AAAA-MM-DD, the format the
// API takes, with a numeric keyboard. Leaving the field checks that it is a real calendar date;
// once valid, the help shows it in words ("25 de octubre de 2026") so the person can confirm it.

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export const DATE_FORMAT_MESSAGE = 'Escriba la fecha como AAAA-MM-DD, por ejemplo 2026-10-25.';

/** True for a real calendar date written AAAA-MM-DD (2026-02-30 is not). */
export function isCalendarDate(text: string): boolean {
  const match = DATE.exec(text.trim());
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

/** The message of a date field, or null when it is fine (empty is fine unless required). */
export function dateError(text: string, required = false): string | null {
  if (text.trim() === '') return required ? 'Escriba la fecha.' : null;
  return isCalendarDate(text) ? null : DATE_FORMAT_MESSAGE;
}

export type DateFieldProps = {
  label: string;
  value: string;
  onChange: (text: string) => void;
  required?: boolean;
  /** Extra help, shown before the date in words. */
  help?: string | null;
  /** From the form or the API; it wins over the field's own check. */
  error?: string | null;
};

export function DateField({
  label,
  value,
  onChange,
  required = false,
  help,
  error,
}: DateFieldProps) {
  const [touched, setTouched] = useState(false);
  const own = touched ? dateError(value, required) : null;
  const inWords = isCalendarDate(value) ? formatDateInWords(value.trim()) : null;
  const helpText = [help, inWords ?? 'AAAA-MM-DD.'].filter(Boolean).join(' ');
  return (
    <TextField
      label={label}
      required={required}
      value={value}
      onChangeText={(text) => onChange(text.replace(/[^\d-]/g, ''))}
      onBlur={() => setTouched(true)}
      keyboardType="numbers-and-punctuation"
      example="2026-10-25"
      help={helpText}
      error={error ?? own}
      maxLength={10}
    />
  );
}
