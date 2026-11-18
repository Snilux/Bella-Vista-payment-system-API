// T-11 · Conceptos y cuota de apertura
import {
  createFeeAmountRequestSchema,
  createFeeRequestSchema,
  FEE_TYPES,
  type Fee,
  formatDate,
  formatMoney,
} from '@bella-vista/shared';
import { router } from 'expo-router';
import { useState } from 'react';
import { describeError, fieldErrors } from '../../../../src/api/error-messages.js';
import { useAddFeeAmount, useCreateFee, useFees } from '../../../../src/api/useRates.js';
import { businessToday } from '../../../../src/features/forms/business-date.js';
import { useCan } from '../../../../src/session/permissions.js';
import {
  AmountField,
  AppText,
  BottomSheet,
  Button,
  colors,
  DataRow,
  DateField,
  Header,
  ListRow,
  MenuGroup,
  Notice,
  ScreenLayout,
  ScreenState,
  Select,
  screenStatusOf,
  TextField,
} from '../../../../src/ui/index.js';

// Charges other than the monthly fee (Figma T-11; 3.2 §10.6; D-13): each concept with its amount
// in force. Changing an amount adds a new one from a date (today or later) and keeps the previous
// one in the history; charges already generated keep theirs. A concept is never edited.

const FEE_TYPE_LABELS: Record<Fee['type'], string> = {
  opening: 'Apertura de toma',
  reconnection: 'Reinstalación',
  repair: 'Reparación',
  other: 'Otro',
};

export default function Fees() {
  const query = useFees();
  const canManage = useCan('rates.register');
  const [chosen, setChosen] = useState<Fee | null>(null);
  const [adding, setAdding] = useState(false);
  const status = screenStatusOf(query, (fees) => fees.length === 0);

  return (
    <ScreenLayout
      {...(canManage
        ? {
            footer: (
              <Button
                label="Agregar concepto"
                variant="secondary"
                onPress={() => setAdding(true)}
              />
            ),
          }
        : {})}
    >
      <Header
        title="Conceptos"
        subtitle="Cobros distintos a la mensualidad"
        onBack={() => router.back()}
      />
      <ScreenState
        status={status}
        error={query.error}
        onRetry={() => void query.refetch()}
        empty={{ message: 'Todavía no hay conceptos.', icon: 'fees' }}
      >
        <MenuGroup>
          {(query.data ?? []).map((fee) => (
            <ListRow
              key={fee.id}
              title={fee.name}
              subtitle={
                fee.currentAmount
                  ? `Desde ${formatDate(fee.currentAmount.effectiveFrom)}`
                  : 'Sin importe vigente'
              }
              {...(fee.currentAmount ? { amountCents: fee.currentAmount.amount } : {})}
              {...(canManage ? { onPress: () => setChosen(fee) } : {})}
            />
          ))}
        </MenuGroup>
        <AppText variant="caption" color={colors.textSecondary}>
          Cambiar un importe crea un registro nuevo. Los cargos ya generados conservan su importe.
        </AppText>
      </ScreenState>

      {chosen ? <AmountSheet fee={chosen} onClose={() => setChosen(null)} /> : null}
      {adding ? <NewFeeSheet onClose={() => setAdding(false)} /> : null}
    </ScreenLayout>
  );
}

/** A new amount from a date; the history stays. */
function AmountSheet({ fee, onClose }: { fee: Fee; onClose: () => void }) {
  const add = useAddFeeAmount(fee.id);
  const [amount, setAmount] = useState<number | null>(null);
  const [effectiveFrom, setEffectiveFrom] = useState(businessToday());
  const [error, setError] = useState<{ amount?: string; effectiveFrom?: string }>({});
  const server = add.isError ? fieldErrors(add.error) : {};
  const general =
    add.isError && Object.keys(server).length === 0 ? describeError(add.error).message : null;

  const submit = () => {
    const parsed = createFeeAmountRequestSchema.safeParse({
      amount: amount ?? undefined,
      effectiveFrom: effectiveFrom.trim(),
    });
    if (!parsed.success || amount === null) {
      setError({
        ...(amount === null ? { amount: 'Escriba el importe.' } : {}),
        ...(parsed.success ? {} : { effectiveFrom: parsed.error.issues[0]?.message ?? '' }),
      });
      return;
    }
    setError({});
    add.mutate(parsed.data, { onSuccess: onClose });
  };

  return (
    <BottomSheet
      visible
      title={fee.name}
      onClose={add.isPending ? () => undefined : onClose}
      footer={
        <>
          <Button label="Guardar importe" onPress={submit} loading={add.isPending} />
          <Button label="Volver" variant="secondary" onPress={onClose} />
        </>
      }
    >
      {fee.currentAmount ? (
        <DataRow
          label={`Vigente desde ${formatDate(fee.currentAmount.effectiveFrom)}`}
          value={formatMoney(fee.currentAmount.amount)}
          amount
        />
      ) : null}
      <AmountField
        label="Importe nuevo"
        required
        valueCents={amount}
        onChangeCents={setAmount}
        error={error.amount ?? server.amount ?? null}
      />
      <DateField
        label="Desde"
        required
        value={effectiveFrom}
        onChange={setEffectiveFrom}
        help="Hoy o después; nunca hacia atrás."
        error={error.effectiveFrom ?? server.effectiveFrom ?? null}
      />
      {general ? <Notice title={general} /> : null}
      {fee.amounts.length > 0 ? (
        <>
          <AppText variant="label">Historial</AppText>
          {fee.amounts.map((item) => (
            <DataRow
              key={item.effectiveFrom}
              label={`Desde ${formatDate(item.effectiveFrom)}`}
              value={formatMoney(item.amount)}
              amount
            />
          ))}
        </>
      ) : null}
    </BottomSheet>
  );
}

function NewFeeSheet({ onClose }: { onClose: () => void }) {
  const create = useCreateFee();
  const [type, setType] = useState<Fee['type']>('other');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const server = create.isError ? fieldErrors(create.error) : {};
  const general =
    create.isError && Object.keys(server).length === 0 ? describeError(create.error).message : null;

  const submit = () => {
    const parsed = createFeeRequestSchema.safeParse({ type, name });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? null);
      return;
    }
    setError(null);
    create.mutate(parsed.data, { onSuccess: onClose });
  };

  return (
    <BottomSheet
      visible
      title="Agregar concepto"
      onClose={create.isPending ? () => undefined : onClose}
      footer={
        <>
          <Button label="Guardar concepto" onPress={submit} loading={create.isPending} />
          <Button label="Volver" variant="secondary" onPress={onClose} />
        </>
      }
    >
      <Select
        label="Tipo"
        required
        options={FEE_TYPES.map((value) => ({ value, label: FEE_TYPE_LABELS[value] }))}
        value={type}
        onChange={setType}
      />
      <TextField
        label="Nombre"
        required
        value={name}
        onChangeText={setName}
        example="Cambio de medidor"
        error={error ?? server.name ?? null}
        maxLength={100}
      />
      <AppText variant="caption" color={colors.textSecondary}>
        Después de crearlo, toque el concepto para registrar su importe.
      </AppText>
      {general ? <Notice title={general} /> : null}
    </BottomSheet>
  );
}
