// T-09 · Pagar al fontanero
import { formatMoney } from '@bella-vista/shared';
import { useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { describeError } from '../../../../../src/api/error-messages.js';
import { isApiError } from '../../../../../src/api/errors.js';
import { useMyCashbox } from '../../../../../src/api/useBilling.js';
import { afterCashMovement } from '../../../../../src/api/useCashboxes.js';
import { payPlumber, usePlumber } from '../../../../../src/api/useCommittee.js';
import { useMoneyOperation } from '../../../../../src/api/useMoneyOperation.js';
import {
  payablePeriods,
  payPeriodShort,
} from '../../../../../src/features/committee/committee-view.js';
import { businessToday } from '../../../../../src/features/forms/business-date.js';
import { MoneyFooter } from '../../../../../src/features/forms/MoneyFooter.js';
import {
  AppText,
  colors,
  DataRow,
  Header,
  Notice,
  ScreenLayout,
  ScreenState,
  Select,
  SuccessScreen,
  SummaryCard,
  screenStatusOf,
} from '../../../../../src/ui/index.js';

// Pay the plumber one period (Figma T-09; RF-GAS-08; D-24): the amount is the authorized salary
// in force for the period (fixed, not typed), from the committee cashbox; a period is paid once.
// It goes through useMoneyOperation with its Idempotency-Key: a retry after a lost answer sends
// the same key and the API answers the same expense, never a second payment.

type Vars = { plumberId: number; date: string };
type Result = Awaited<ReturnType<typeof payPlumber>>;

export default function PayPlumber() {
  const params = useLocalSearchParams<{ id?: string }>();
  const plumberId = Number(params.id);
  const queryClient = useQueryClient();
  const query = usePlumber(Number.isInteger(plumberId) ? plumberId : null);
  const cashbox = useMyCashbox();
  const plumber = query.data;
  const periods = useMemo(
    () => (plumber ? payablePeriods(plumber, businessToday()) : []),
    [plumber],
  );
  const [chosen, setChosen] = useState<string | null>(null);
  const period = periods.find((item) => item.start === chosen) ?? periods[0] ?? null;
  const onSuccess = useCallback(() => afterCashMovement(queryClient), [queryClient]);
  const operation = useMoneyOperation<Vars, Result>(payPlumber, { onSuccess });
  const header = (
    <Header
      title="Pagar al fontanero"
      {...(plumber ? { subtitle: plumber.name } : {})}
      onBack={() => router.back()}
    />
  );

  if (operation.status === 'success' && operation.data) {
    const { expense } = operation.data;
    return (
      <SuccessScreen
        title="Pago registrado"
        message="Se descontó de la caja del comité."
        onDone={() => router.back()}
        doneLabel="Volver al fontanero"
      >
        <SummaryCard tone="plain">
          <DataRow label="Folio" value={expense.folio} />
          {expense.plumberPayment ? (
            <DataRow
              label="Periodo"
              value={payPeriodShort(
                expense.plumberPayment.periodStart,
                expense.plumberPayment.periodEnd,
              )}
            />
          ) : null}
          <DataRow label="Importe" value={formatMoney(expense.amount)} amount />
        </SummaryCard>
      </SuccessScreen>
    );
  }

  if (!plumber) {
    return (
      <ScreenLayout>
        {header}
        <ScreenState
          status={screenStatusOf(query)}
          error={query.error}
          onRetry={() => void query.refetch()}
        />
      </ScreenLayout>
    );
  }

  const balance = cashbox.data?.balance ?? null;
  const amount = period?.salary.amount ?? null;
  const short = amount !== null && balance !== null && amount > balance;
  const failure =
    operation.status === 'failed'
      ? isApiError(operation.error) && operation.error.code === 'PERIOD_ALREADY_PAID'
        ? 'Ese periodo ya está pagado.'
        : describeError(operation.error).message
      : null;
  const locked = operation.status === 'unknown' || operation.sending;

  return (
    <ScreenLayout
      footer={
        <MoneyFooter
          operation={operation}
          label="Registrar pago"
          onPress={() => {
            if (period) void operation.submit({ plumberId: plumber.id, date: period.start });
          }}
          disabledReason={
            !period
              ? 'No hay periodos por pagar.'
              : short && balance !== null
                ? `No hay saldo suficiente: la caja del comité tiene ${formatMoney(balance)}.`
                : null
          }
        />
      }
    >
      {header}
      {periods.length === 0 ? (
        <Notice
          icon="info"
          title="No hay periodos por pagar."
          detail="Los periodos con salario autorizado ya están pagados."
        />
      ) : (
        <Select
          label="Periodo"
          required
          options={periods.map((item) => ({
            value: item.start,
            label: payPeriodShort(item.start, item.end),
          }))}
          value={period?.start ?? null}
          onChange={(value) => {
            if (locked) return;
            setChosen(value);
            if (operation.status === 'failed') operation.reset();
          }}
        />
      )}
      {period ? (
        <SummaryCard>
          <DataRow label="Salario fijo" value={formatMoney(period.salary.amount)} amount />
          <DataRow label="Acuerdo" value={period.salary.agreement.folio} />
          {balance !== null ? (
            <>
              <DataRow label="Caja del comité" value={formatMoney(balance)} amount />
              <DataRow label="Quedará" value={formatMoney(balance - period.salary.amount)} amount />
            </>
          ) : null}
        </SummaryCard>
      ) : null}
      <AppText variant="caption" color={colors.textSecondary}>
        El importe es el salario fijado por el comité y no se cambia aquí. Un periodo solo se paga
        una vez.
      </AppText>
      {short ? (
        <Notice
          title="No hay saldo suficiente en la caja del comité para este pago."
          detail="Registre las entregas pendientes o un ingreso antes de pagar."
        />
      ) : null}
      {operation.status === 'unknown' ? <Notice title="No sabemos si se registró." /> : null}
      {failure ? <Notice title={failure} /> : null}
    </ScreenLayout>
  );
}
