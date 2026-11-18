import { type ApprovalSubject, formatDate, formatMoney, formatPeriod } from '@bella-vista/shared';
import { router } from 'expo-router';
import { usePayment } from '../../api/useBilling.js';
import { useHandover } from '../../api/useCashboxes.js';
import { useExpense } from '../../api/useCommittee.js';
import { useRates } from '../../api/useRates.js';
import { AppText, Button, colors, DataRow, SummaryCard } from '../../ui/index.js';
import { monthsSummary } from '../billing/billing-view.js';
import { cashboxTitle, HANDOVER_TAGS } from '../cashboxes/cashbox-view.js';
import { EXPENSE_TAGS } from '../committee/committee-view.js';

// R-03: the real record an approval is about (its `subject`, option (b) of 3.2 §6 M6). A payment
// cancellation shows the payment (folio, amount, months, receipt, cashbox) and opens G-05; a
// rate shows its amount, month and agreement; a family change opens G-04; an adjustment shows its
// handover (declared, received, shortfall); a refund shows the expense (M7). Each one is loaded
// with the president's own permissions.

export function ApprovalSubjectDetail({ subject }: { subject: ApprovalSubject | null }) {
  if (!subject) return null;
  switch (subject.type) {
    case 'payment':
      return <PaymentSubject id={subject.id} />;
    case 'rate':
      return <RateSubject id={subject.id} />;
    case 'handover':
      return <HandoverSubject id={subject.id} />;
    case 'expense':
      return <ExpenseSubject id={subject.id} />;
    case 'unit':
      return (
        <Button
          label="Ver la familia"
          variant="text"
          onPress={() => router.push(`/common/units/${subject.id}`)}
        />
      );
    default:
      return null;
  }
}

function PaymentSubject({ id }: { id: number }) {
  const query = usePayment(id);
  const payment = query.data;
  if (!payment) {
    return query.isError ? (
      <AppText variant="caption" color={colors.textSecondary}>
        No se pudo cargar el pago.
      </AppText>
    ) : null;
  }
  const receipt = payment.receipts.at(-1);
  return (
    <>
      <SummaryCard>
        <DataRow label="Pago" value={payment.folio} />
        <DataRow label="Importe" value={formatMoney(payment.total)} amount />
        {payment.months.length > 0 ? (
          <DataRow
            label="Meses"
            value={monthsSummary(payment.months.map((month) => month.period))}
          />
        ) : null}
        {payment.charges.map((charge) => (
          <DataRow
            key={charge.id}
            label={charge.feeName}
            value={formatMoney(charge.amount)}
            amount
          />
        ))}
        {receipt ? <DataRow label="Recibo" value={receipt.paperFolio} /> : null}
        {payment.unit?.holder ? <DataRow label="Titular" value={payment.unit.holder} /> : null}
      </SummaryCard>
      <AppText variant="caption" color={colors.textSecondary}>
        {`Al autorizar, los meses vuelven a quedar pendientes y el importe sale de la caja ${payment.cashbox.label}.`}
      </AppText>
      <Button
        label="Ver el pago"
        variant="text"
        onPress={() => router.push(`/common/payments/${payment.id}`)}
      />
    </>
  );
}

function RateSubject({ id }: { id: number }) {
  const query = useRates();
  const rate = query.data?.find((item) => item.id === id);
  if (!rate) return null;
  return (
    <SummaryCard>
      <DataRow label="Tarifa" value={formatMoney(rate.amount)} amount />
      <DataRow label="Desde" value={formatPeriod(rate.effectivePeriod)} />
      <DataRow label="Acuerdo" value={rate.agreement.folio} />
      <DataRow label="Aprobada en junta" value={formatDate(rate.approvedOn)} />
    </SummaryCard>
  );
}

function NotLoaded({ what }: { what: string }) {
  return (
    <AppText variant="caption" color={colors.textSecondary}>
      {`No se pudo cargar ${what}.`}
    </AppText>
  );
}

/** adjustment: the handover whose shortfall is written off (D-16). */
function HandoverSubject({ id }: { id: number }) {
  const query = useHandover(id);
  const handover = query.data;
  if (!handover) return query.isError ? <NotLoaded what="la entrega" /> : null;
  return (
    <>
      <SummaryCard>
        <DataRow label="Entrega" value={handover.folio} />
        <DataRow label="Caja" value={cashboxTitle(handover.cashbox)} />
        <DataRow label="Preparó" value={handover.preparedBy.fullName} />
        <DataRow label="Fecha" value={formatDate(handover.date)} />
        <DataRow label="Declarado" value={formatMoney(handover.declaredAmount)} amount />
        {handover.receivedAmount !== null ? (
          <DataRow label="Recibido" value={formatMoney(handover.receivedAmount)} amount />
        ) : null}
        {handover.difference ? (
          <DataRow label="Faltante" value={formatMoney(handover.difference)} amount />
        ) : null}
        <DataRow label="Estado" value={HANDOVER_TAGS[handover.status].label} />
      </SummaryCard>
      <AppText variant="caption" color={colors.textSecondary}>
        {`Al autorizar, el faltante sale de la caja ${cashboxTitle(handover.cashbox)} y la entrega queda aclarada. Al rechazar, sigue en esa caja.`}
      </AppText>
    </>
  );
}

/** expense_refund: the paid expense whose amount returns to the committee cashbox. */
function ExpenseSubject({ id }: { id: number }) {
  const query = useExpense(id);
  const expense = query.data;
  if (!expense) return query.isError ? <NotLoaded what="el gasto" /> : null;
  return (
    <SummaryCard>
      <DataRow label="Gasto" value={expense.folio} />
      <DataRow label="Categoría" value={expense.category.name} />
      <DataRow label="Descripción" value={expense.description} />
      <DataRow label="Importe" value={formatMoney(expense.amount)} amount />
      {expense.agreement ? <DataRow label="Acuerdo" value={expense.agreement.folio} /> : null}
      {expense.paidOn ? <DataRow label="Pagado" value={formatDate(expense.paidOn)} /> : null}
      {expense.voucherReference ? (
        <DataRow label="Comprobante" value={expense.voucherReference} />
      ) : null}
      <DataRow label="Estado" value={EXPENSE_TAGS[expense.status].label} />
    </SummaryCard>
  );
}
