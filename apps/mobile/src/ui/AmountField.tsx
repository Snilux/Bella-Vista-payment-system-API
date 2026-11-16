import { formatMoney, parseMoney } from '@bella-vista/shared';
import { useState } from 'react';
import { TextField, type TextFieldProps } from './TextField.js';

// Campo de importe (3.2 §11.1, 2.4 §6.2): fixed "$" prefix, numeric keyboard, commas when
// leaving the field, and it hands back whole cents (never decimals, via shared parseMoney).

export const INVALID_AMOUNT_MESSAGE = 'Escriba un importe válido, por ejemplo 1,250.00.';

export type AmountFieldProps = Omit<
  TextFieldProps,
  'value' | 'onChangeText' | 'prefix' | 'keyboardType' | 'password' | 'defaultValue'
> & {
  /** Cents, or null while empty or not a valid amount. */
  valueCents: number | null;
  onChangeCents: (cents: number | null) => void;
};

/** Cents → "1,250.00" (the "$" is the field's prefix). */
const display = (cents: number) => formatMoney(cents).replace('$', '');

export function AmountField({
  valueCents,
  onChangeCents,
  error = null,
  onBlur,
  ...fieldProps
}: AmountFieldProps) {
  const [text, setText] = useState(() => (valueCents === null ? '' : display(valueCents)));
  const [touched, setTouched] = useState(false);

  // The parent set another amount (e.g. "Entregar todo"): show it. Echoes of what was typed
  // (same cents) leave the text alone so "1250.5" is not rewritten while typing.
  const parsed = parseMoney(text);
  const [previousValue, setPreviousValue] = useState(valueCents);
  if (valueCents !== previousValue) {
    setPreviousValue(valueCents);
    if (valueCents !== parsed) setText(valueCents === null ? '' : display(valueCents));
  }

  const invalid = touched && text.trim() !== '' && parsed === null;

  return (
    <TextField
      {...fieldProps}
      value={text}
      prefix="$"
      keyboardType="decimal-pad"
      inputMode="decimal"
      error={error ?? (invalid ? INVALID_AMOUNT_MESSAGE : null)}
      onChangeText={(next) => {
        setText(next);
        const cents = parseMoney(next);
        onChangeCents(cents);
      }}
      onBlur={(event) => {
        setTouched(true);
        if (parsed !== null) setText(display(parsed));
        onBlur?.(event);
      }}
    />
  );
}
