import { type ApprovalSubject, formatDate, formatMoney, formatPeriod } from '@bella-vista/shared';
import { router } from 'expo-router';
import { usePayment } from '../../api/useBilling.js';
import { useRates } from '../../api/useRates.js';
import { AppText, Button, colors, DataRow, SummaryCard } from '../../ui/index.js';
import { monthsSummary } from '../billing/billing-view.js';

// R-03: the real record an approval is about (its `subject`, option (b) of 3.2 §6 M6). A payment
// cancellation shows the payment (folio, amount, months, receipt, cashbox) and opens G-05; a
// rate shows its amount, month and agreement; a family change opens G-04. Each one is loaded
// with the president's own permissions.

export function ApprovalSubjectDetail({ subject }: { subject: ApprovalSubject | null }) {
  if (!subject) return null;
  switch (subject.type) {
    case 'payment':
      return <PaymentSubject id={subject.id} />;
    case 'rate':
      return <RateSubject id={subject.id} />;
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
