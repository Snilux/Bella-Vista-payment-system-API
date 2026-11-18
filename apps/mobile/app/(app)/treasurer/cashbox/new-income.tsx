// T-05 · Registrar ingreso
import {
  type CreateIncomeRequest,
  createIncomeRequestSchema,
  formatMoney,
} from '@bella-vista/shared';
import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useCallback, useState } from 'react';
import { describeError, fieldErrors } from '../../../../src/api/error-messages.js';
import { afterCashMovement } from '../../../../src/api/useCashboxes.js';
import { createIncome } from '../../../../src/api/useCommittee.js';
import { useMoneyOperation } from '../../../../src/api/useMoneyOperation.js';
import { businessToday } from '../../../../src/features/forms/business-date.js';
import {
  DiscardChangesSheet,
  useDiscardGuard,
} from '../../../../src/features/forms/DiscardChangesSheet.js';
import { MoneyFooter } from '../../../../src/features/forms/MoneyFooter.js';
import {
  AmountField,
  DataRow,
  DateField,
  dateError,
  Header,
  Notice,
  ScreenLayout,
  SuccessScreen,
  SummaryCard,
  TextField,
} from '../../../../src/ui/index.js';

// An income of the committee cashbox that is not a payment (Figma T-05; RF-GAS; D-21): a
// donation, a sale. Concept, amount, date (today or before) and, optionally, the voucher. It
// moves money: useMoneyOperation with its Idempotency-Key.

type Field = 'concept' | 'amount' | 'date' | 'voucherReference';
type Result = Awaited<ReturnType<typeof createIncome>>;

export default function NewIncome() {
  const queryClient = useQueryClient();
  const today = businessToday();
  const [concept, setConcept] = useState('');
  const [amount, setAmount] = useState<number | null>(null);
  const [date, setDate] = useState(today);
  const [voucher, setVoucher] = useState('');
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const onSuccess = useCallback(() => afterCashMovement(queryClient), [queryClient]);
  const operation = useMoneyOperation<CreateIncomeRequest, Result>(createIncome, { onSuccess });
  const guard = useDiscardGuard(
    (concept !== '' || amount !== null || voucher !== '') && operation.status !== 'success',
    { unknown: operation.status === 'unknown' },
  );

  if (operation.status === 'success' && operation.data) {
    const { income } = operation.data;
    return (
      <SuccessScreen
        title="Ingreso registrado"
        message="Ya está en la caja del comité."
        onDone={() => router.back()}
        doneLabel="Volver a la caja"
      >
        <SummaryCard tone="plain">
          <DataRow label="Folio" value={income.folio} />
          <DataRow label="Concepto" value={income.concept} />
          <DataRow label="Importe" value={formatMoney(income.amount)} amount />
          <DataRow label="Fecha" value={income.date} />
        </SummaryCard>
      </SuccessScreen>
    );
  }

  const server = operation.status === 'failed' ? fieldErrors(operation.error) : {};
  const general =
    operation.status === 'failed' && Object.keys(server).length === 0
      ? describeError(operation.error).message
      : null;
  const errorOf = (field: Field) => errors[field] ?? server[field] ?? null;
  const locked = operation.status === 'unknown' || operation.sending;
  const edit =
    <T,>(set: (value: T) => void) =>
    (value: T) => {
      set(value);
      if (operation.status === 'failed') operation.reset();
    };

  const submit = () => {
    const next: Partial<Record<Field, string>> = {};
    const dateProblem =
      dateError(date, true) ?? (date > today ? 'La fecha no puede ser posterior a hoy.' : null);
    if (dateProblem) next.date = dateProblem;
    const parsed = createIncomeRequestSchema.safeParse({
      concept,
      amount: amount ?? undefined,
      date,
      voucherReference: voucher,
    });
    if (!parsed.success) {
      for (const issue of parsed.error.issues)
        next[String(issue.path[0]) as Field] ??= issue.message;
    }
    if (amount === null) next.amount = 'Escriba el importe.';
    setErrors(next);
    if (parsed.success && Object.keys(next).length === 0) void operation.submit(parsed.data);
  };

  return (
    <ScreenLayout
      footer={<MoneyFooter operation={operation} label="Guardar ingreso" onPress={submit} />}
    >
      <Header title="Registrar ingreso" subtitle="Caja del comité" onBack={() => router.back()} />
      <TextField
        label="Concepto"
        required
        value={concept}
        onChangeText={edit(setConcept)}
        example="Donativo para tubería"
        maxLength={200}
        error={errorOf('concept')}
        editable={!locked}
      />
      <AmountField
        label="Importe"
        required
        valueCents={amount}
        onChangeCents={edit(setAmount)}
        error={errorOf('amount')}
        editable={!locked}
      />
      <DateField
        label="Fecha"
        required
        value={date}
        onChange={edit(setDate)}
        error={errorOf('date')}
      />
      <TextField
        label="Referencia del comprobante"
        value={voucher}
        onChangeText={edit(setVoucher)}
        help="Opcional. Escriba el número de nota o recibo."
        maxLength={100}
        error={errorOf('voucherReference')}
        editable={!locked}
      />
      {operation.status === 'unknown' ? <Notice title="No sabemos si se registró." /> : null}
      {general ? <Notice title={general} /> : null}
      <DiscardChangesSheet guard={guard} />
    </ScreenLayout>
  );
}
