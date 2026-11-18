// T-12 · Saldos iniciales
import { type CashboxListItem, openingBalanceRequestSchema } from '@bella-vista/shared';
import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useCallback, useState } from 'react';
import { View } from 'react-native';
import { describeError, fieldErrors } from '../../../../src/api/error-messages.js';
import {
  afterCashMovement,
  requestOpeningBalance,
  useCashboxes,
} from '../../../../src/api/useCashboxes.js';
import { useMoneyOperation } from '../../../../src/api/useMoneyOperation.js';
import { cashboxTitle, openingRow } from '../../../../src/features/cashboxes/cashbox-view.js';
import { businessToday } from '../../../../src/features/forms/business-date.js';
import { MoneyFooter } from '../../../../src/features/forms/MoneyFooter.js';
import {
  AmountField,
  AppText,
  BottomSheet,
  Button,
  colors,
  DateField,
  dateError,
  Header,
  ListRow,
  Notice,
  ScreenLayout,
  ScreenState,
  Select,
  screenStatusOf,
  TextField,
} from '../../../../src/ui/index.js';

// The opening balance of each cashbox (Figma T-12; RF-CAJ-03; D-18): one row per cashbox with
// its status (confirmed by the president, pending, rejected or not captured). "Capturar saldo"
// sends one for a cashbox without a pending or authorized one; it stays pending until the
// president authorizes it. It goes through useMoneyOperation with its Idempotency-Key.

export default function OpeningBalances() {
  const query = useCashboxes();
  const [capturing, setCapturing] = useState<number | 'choose' | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const capturable = (query.data ?? []).filter((item) => openingRow(item).capturable);

  return (
    <ScreenLayout
      footer={
        <Button
          label="Capturar saldo"
          onPress={() => setCapturing('choose')}
          disabledReason={
            query.data && capturable.length === 0
              ? 'Todas las cajas ya tienen su saldo inicial capturado.'
              : null
          }
        />
      }
    >
      <Header
        title="Saldos iniciales"
        subtitle="Se capturan una sola vez al arrancar"
        onBack={() => router.back()}
      />
      {sent ? <Notice icon="success" title={sent} /> : null}
      <ScreenState
        status={screenStatusOf(query)}
        error={query.error}
        onRetry={() => void query.refetch()}
      >
        <View>
          {(query.data ?? []).map((item) => {
            const row = openingRow(item);
            return (
              <ListRow
                key={item.id}
                title={cashboxTitle(item)}
                subtitle={row.subtitle}
                {...(row.tag ? { tag: row.tag } : {})}
                {...(row.amount !== undefined ? { amountCents: row.amount } : {})}
                {...(row.capturable ? { onPress: () => setCapturing(item.id) } : {})}
              />
            );
          })}
        </View>
      </ScreenState>
      <AppText variant="caption" color={colors.textSecondary}>
        Una vez confirmado, el saldo inicial no se puede cambiar; las diferencias se corrigen con
        una aclaración.
      </AppText>
      {capturing !== null ? (
        <CaptureSheet
          cashboxes={capturable}
          initial={capturing === 'choose' ? null : capturing}
          onClose={() => setCapturing(null)}
          onSent={(label) => {
            setCapturing(null);
            setSent(
              `Saldo inicial de ${label} enviado al presidente: queda pendiente de autorizar.`,
            );
          }}
        />
      ) : null}
    </ScreenLayout>
  );
}

type Field = 'cashboxId' | 'amount' | 'date' | 'reason';
type Vars = { cashboxId: number; amount: number; date: string; reason: string };
type Result = Awaited<ReturnType<typeof requestOpeningBalance>>;

function CaptureSheet({
  cashboxes,
  initial,
  onClose,
  onSent,
}: {
  cashboxes: CashboxListItem[];
  initial: number | null;
  onClose: () => void;
  onSent: (label: string) => void;
}) {
  const queryClient = useQueryClient();
  const today = businessToday();
  const [cashboxId, setCashboxId] = useState<number | null>(initial);
  const [amount, setAmount] = useState<number | null>(null);
  const [date, setDate] = useState(today);
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const chosen = cashboxes.find((item) => item.id === cashboxId) ?? null;
  const onSuccess = useCallback(() => {
    afterCashMovement(queryClient);
    if (chosen) onSent(cashboxTitle(chosen));
  }, [queryClient, chosen, onSent]);
  const operation = useMoneyOperation<Vars, Result>(requestOpeningBalance, { onSuccess });
  const server = operation.status === 'failed' ? fieldErrors(operation.error) : {};
  const general =
    operation.status === 'failed' && Object.keys(server).length === 0
      ? describeError(operation.error).message
      : null;
  const errorOf = (field: Field) => errors[field] ?? server[field] ?? null;
  const locked = operation.status === 'unknown' || operation.sending;

  const submit = () => {
    const next: Partial<Record<Field, string>> = {};
    if (cashboxId === null) next.cashboxId = 'Elija la caja.';
    const parsed = openingBalanceRequestSchema.safeParse({
      amount: amount ?? undefined,
      date,
      reason,
    });
    if (!parsed.success) {
      for (const issue of parsed.error.issues)
        next[String(issue.path[0]) as Field] ??= issue.message;
    }
    const dateProblem =
      dateError(date, true) ?? (date > today ? 'La fecha no puede ser posterior a hoy.' : null);
    if (dateProblem) next.date = dateProblem;
    if (amount === null) next.amount = 'Escriba el importe contado.';
    setErrors(next);
    if (!parsed.success || cashboxId === null || Object.keys(next).length > 0) return;
    void operation.submit({ cashboxId, ...parsed.data });
  };

  return (
    <BottomSheet
      visible
      title="Capturar saldo inicial"
      onClose={locked ? () => undefined : onClose}
      footer={<MoneyFooter operation={operation} label="Enviar al presidente" onPress={submit} />}
    >
      <Select
        label="Caja"
        required
        options={cashboxes.map((item) => ({ value: item.id, label: cashboxTitle(item) }))}
        value={cashboxId}
        onChange={(value) => {
          if (!locked) setCashboxId(value);
        }}
        placeholder="Elija la caja"
        help="Solo las cajas sin un saldo pendiente o confirmado."
        error={errorOf('cashboxId')}
      />
      <AmountField
        label="Importe contado"
        required
        valueCents={amount}
        onChangeCents={setAmount}
        error={errorOf('amount')}
        editable={!locked}
      />
      <DateField
        label="Fecha del conteo"
        required
        value={date}
        onChange={setDate}
        error={errorOf('date')}
      />
      <TextField
        label="Motivo o referencia del conteo"
        required
        value={reason}
        onChangeText={setReason}
        maxLength={500}
        multiline
        error={errorOf('reason')}
        editable={!locked}
      />
      {operation.status === 'unknown' ? <Notice title="No sabemos si se registró." /> : null}
      {general ? <Notice title={general} /> : null}
    </BottomSheet>
  );
}
