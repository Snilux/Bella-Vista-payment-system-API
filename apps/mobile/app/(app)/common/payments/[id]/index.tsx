// G-05 · Detalle de pago
import { formatDateTime, formatMoney, formatPeriod } from '@bella-vista/shared';
import { router, useLocalSearchParams } from 'expo-router';
import { usePayment } from '../../../../../src/api/useBilling.js';
import { breakdown } from '../../../../../src/features/billing/billing-view.js';
import { useCan } from '../../../../../src/session/permissions.js';
import {
  AppText,
  Button,
  DataRow,
  Header,
  ListRow,
  MenuGroup,
  Notice,
  ScreenLayout,
  ScreenState,
  StatusTag,
  SummaryCard,
  screenStatusOf,
} from '../../../../../src/ui/index.js';

// A payment (Figma G-05; 3.2 §10.2; D-15, D-23): months with their rate and surcharge, charges,
// cashbox, who collected and the paper receipts. "Reposición de recibo" (G-10) and "Solicitar
// cancelación" (G-11, money: with its Idempotency-Key). A cancelled payment shows "Cancelado"
// and no actions; one whose cancellation waits for the president says so.

export default function PaymentDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const query = usePayment(Number(id));
  const canReplace = useCan('receipts.replace');
  const canCancel = useCan('payments.requestCancellation');
  const status = screenStatusOf(query);
  const payment = query.data;

  if (status !== 'ready' || !payment) {
    return (
      <ScreenLayout>
        <Header title="Detalle de pago" onBack={() => router.back()} />
        <ScreenState status={status} error={query.error} onRetry={() => void query.refetch()} />
      </ScreenLayout>
    );
  }

  const pendingCancellation = payment.cancellations.some((item) => item.status === 'pending');
  const receipt = payment.receipts.at(-1);
  const actions = !payment.cancelled;
  const footer =
    actions && (canReplace || (canCancel && !pendingCancellation)) ? (
      <>
        {canReplace ? (
          <Button
            label="Reposición de recibo"
            variant="secondary"
            onPress={() =>
              router.push({
                pathname: '/common/payments/[id]/replacement',
                params: { id: String(payment.id) },
              })
            }
          />
        ) : null}
        {canCancel && !pendingCancellation ? (
          <Button
            label="Solicitar cancelación"
            variant="text"
            onPress={() =>
              router.push({
                pathname: '/common/approval-request',
                params: {
                  type: 'payment_cancellation',
                  id: String(payment.id),
                  subject: `Pago ${payment.folio} · ${formatMoney(payment.total)}`,
                },
              })
            }
          />
        ) : null}
      </>
    ) : null;

  return (
    <ScreenLayout {...(footer ? { footer } : {})}>
      <Header
        title={`Pago ${payment.folio}`}
        subtitle={formatDateTime(payment.occurredAt)}
        onBack={() => router.back()}
      />
      {payment.cancelled ? <StatusTag tone="cancelled" /> : null}
      {pendingCancellation && !payment.cancelled ? (
        <Notice
          icon="info"
          title="La cancelación de este pago espera la autorización del presidente."
        />
      ) : null}

      <SummaryCard total={{ label: 'Total', amountCents: payment.total }}>
        {payment.unit?.holder ? <DataRow label="Titular" value={payment.unit.holder} /> : null}
        {payment.unit ? <DataRow label="Familia" value={payment.unit.folio} /> : null}
        <DataRow label="Cobró" value={payment.capturedBy.username} />
        <DataRow label="Caja" value={payment.cashbox.label} />
        {receipt ? (
          <DataRow
            label="Recibo"
            value={`${receipt.paperFolio} (${receipt.type === 'original' ? 'original' : 'reposición'})`}
          />
        ) : null}
      </SummaryCard>

      {payment.months.length > 0 ? (
        <MenuGroup>
          {payment.months.map((month) => (
            <ListRow
              key={month.period}
              title={formatPeriod(month.period)}
              subtitle={breakdown(month)}
              amountCents={month.total}
            />
          ))}
        </MenuGroup>
      ) : null}
      {payment.charges.length > 0 ? (
        <MenuGroup>
          {payment.charges.map((charge) => (
            <ListRow key={charge.id} title={charge.feeName} amountCents={charge.amount} />
          ))}
        </MenuGroup>
      ) : null}

      {payment.receipts.length > 1 ? (
        <>
          <AppText variant="heading">Recibos de papel</AppText>
          <MenuGroup>
            {payment.receipts.map((item) => (
              <ListRow
                key={item.id}
                title={item.paperFolio}
                subtitle={`${item.type === 'original' ? 'Original' : 'Reposición'} · ${formatDateTime(item.issuedAt)}`}
              />
            ))}
          </MenuGroup>
        </>
      ) : null}
    </ScreenLayout>
  );
}
