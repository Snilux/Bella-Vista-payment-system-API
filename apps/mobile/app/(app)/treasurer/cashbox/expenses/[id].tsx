// T-07 · Detalle de gasto
import { type Expense, formatDate, formatMoney } from '@bella-vista/shared';
import { useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { type ReactNode, useCallback, useState } from 'react';
import { describeError } from '../../../../../src/api/error-messages.js';
import { queryKeys } from '../../../../../src/api/keys.js';
import { useMyCashbox } from '../../../../../src/api/useBilling.js';
import { afterCashMovement } from '../../../../../src/api/useCashboxes.js';
import { payExpense, useExpense, useRejectExpense } from '../../../../../src/api/useCommittee.js';
import { useMoneyOperation } from '../../../../../src/api/useMoneyOperation.js';
import {
  afterPayingNotice,
  EXPENSE_TAGS,
  payBlockedReason,
  payPeriodShort,
} from '../../../../../src/features/committee/committee-view.js';
import { MoneyFooter } from '../../../../../src/features/forms/MoneyFooter.js';
import { ReasonSheet } from '../../../../../src/features/forms/ReasonSheet.js';
import {
  Button,
  DataRow,
  Header,
  Notice,
  ScreenLayout,
  ScreenState,
  StatusTag,
  SummaryCard,
  screenStatusOf,
} from '../../../../../src/ui/index.js';

// One committee expense (Figma T-07; RF-GAS; D-17, D-21). Pending: "Marcar como pagado" (from
// the committee cashbox, blocked with the reason when the balance is not enough; useMoneyOperation
// with its Idempotency-Key) and "Rechazar gasto" with a reason. Paid: "Solicitar reintegro" (G-11,
// the president authorizes it and the amount returns to the cashbox). Money is never edited.

type Result = Awaited<ReturnType<typeof payExpense>>;

export default function ExpenseDetail() {
  const params = useLocalSearchParams<{ id?: string }>();
  const id = Number(params.id);
  const query = useExpense(id);
  const expense = query.data;
  const header = (
    <Header
      title={expense ? `Gasto ${expense.folio}` : 'Gasto'}
      {...(expense ? { subtitle: expense.category.name } : {})}
      onBack={() => router.back()}
    />
  );
  if (!expense) {
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
  return expense.status === 'pending_payment' ? (
    <PendingExpense expense={expense} header={header} />
  ) : (
    <ClosedExpense expense={expense} header={header} />
  );
}

function ExpenseData({ expense }: { expense: Expense }) {
  const tag = EXPENSE_TAGS[expense.status];
  return (
    <>
      <StatusTag tone={tag.tone} label={tag.label} />
      <SummaryCard tone="plain">
        <DataRow label="Descripción" value={expense.description} />
        <DataRow label="Importe" value={formatMoney(expense.amount)} amount />
        {expense.agreement ? <DataRow label="Acuerdo" value={expense.agreement.folio} /> : null}
        {expense.plumberPayment ? (
          <DataRow
            label="Periodo"
            value={payPeriodShort(
              expense.plumberPayment.periodStart,
              expense.plumberPayment.periodEnd,
            )}
          />
        ) : null}
        {expense.voucherReference ? (
          <DataRow label="Comprobante" value={expense.voucherReference} />
        ) : null}
        {expense.paidOn ? <DataRow label="Pagado" value={formatDate(expense.paidOn)} /> : null}
        {expense.rejectedOn ? (
          <DataRow label="Rechazado" value={formatDate(expense.rejectedOn)} />
        ) : null}
        {expense.rejectionReason ? (
          <DataRow label="Motivo" value={expense.rejectionReason} />
        ) : null}
      </SummaryCard>
    </>
  );
}

function PendingExpense({ expense, header }: { expense: Expense; header: ReactNode }) {
  const queryClient = useQueryClient();
  const cashbox = useMyCashbox();
  const reject = useRejectExpense(expense.id);
  const [rejecting, setRejecting] = useState(false);
  const onSuccess = useCallback(
    ({ expense: paid }: Result) => {
      queryClient.setQueryData(queryKeys.expense(paid.id), { expense: paid });
      afterCashMovement(queryClient);
    },
    [queryClient],
  );
  const pay = useMoneyOperation<number, Result>(payExpense, { onSuccess });
  const balance = cashbox.data?.balance ?? null;
  const blocked = payBlockedReason(expense.amount, balance);
  const failure = pay.status === 'failed' ? describeError(pay.error).message : null;

  return (
    <ScreenLayout
      footer={
        <MoneyFooter
          operation={pay}
          label="Marcar como pagado"
          loadingLabel="Pagando..."
          onPress={() => void pay.submit(expense.id)}
          disabledReason={blocked}
          secondary={
            pay.status === 'unknown' ? null : (
              <Button
                label="Rechazar gasto"
                variant="secondary"
                onPress={() => {
                  reject.reset();
                  setRejecting(true);
                }}
                disabledReason={pay.sending ? 'Espere a que termine de pagar.' : null}
              />
            )
          }
        />
      }
    >
      {header}
      <ExpenseData expense={expense} />
      {blocked ? (
        <Notice title={blocked} />
      ) : balance !== null ? (
        <Notice icon="info" title={afterPayingNotice(expense.amount, balance)} />
      ) : null}
      {pay.status === 'unknown' ? <Notice title="No sabemos si se pagó." /> : null}
      {failure ? <Notice title={failure} /> : null}
      <ReasonSheet
        visible={rejecting}
        title="Rechazar gasto"
        summary={`${expense.folio} · ${formatMoney(expense.amount)}. No se paga y no mueve la caja.`}
        reasonLabel="Motivo del rechazo"
        confirmLabel="Rechazar gasto"
        needsReason="Escriba el motivo del rechazo."
        loading={reject.isPending}
        serverError={reject.isError ? describeError(reject.error).message : null}
        onConfirm={(reason) => reject.mutate(reason, { onSuccess: () => setRejecting(false) })}
        onCancel={() => setRejecting(false)}
      />
    </ScreenLayout>
  );
}

function ClosedExpense({ expense, header }: { expense: Expense; header: ReactNode }) {
  const pendingRefund = expense.refunds.some((refund) => refund.status === 'pending');
  const canRefund = expense.status === 'paid' && !pendingRefund;
  return (
    <ScreenLayout
      {...(canRefund
        ? {
            footer: (
              <Button
                label="Solicitar reintegro"
                variant="secondary"
                onPress={() =>
                  router.push({
                    pathname: '/common/approval-request',
                    params: {
                      type: 'expense_refund',
                      id: String(expense.id),
                      subject: `Gasto ${expense.folio} · ${formatMoney(expense.amount)}`,
                    },
                  })
                }
              />
            ),
          }
        : {})}
    >
      {header}
      <ExpenseData expense={expense} />
      {pendingRefund ? (
        <Notice
          icon="info"
          title="Reintegro pendiente de autorizar."
          detail="Mientras el presidente no lo autorice, el gasto sigue pagado."
        />
      ) : null}
      {expense.status === 'refunded' ? (
        <Notice icon="info" title="El importe regresó a la caja del comité." />
      ) : null}
    </ScreenLayout>
  );
}
