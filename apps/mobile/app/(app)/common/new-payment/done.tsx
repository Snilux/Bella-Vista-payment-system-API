// F-04 · Pago registrado
import { formatMoney } from '@bella-vista/shared';
import { Redirect, router } from 'expo-router';
import { monthsSummary } from '../../../../src/features/billing/billing-view.js';
import { usePaymentFlow } from '../../../../src/features/billing/PaymentFlow.js';
import { homeHref } from '../../../../src/session/role-menu.js';
import { useAccount } from '../../../../src/session/session-store.js';
import { DataRow, SuccessScreen } from '../../../../src/ui/index.js';

// The payment went in (Figma F-04; 3.2 §10.3): the data to copy on the paper receipt. "Listo"
// goes back to the home of the role (the statement, the files, the search and "Mi caja" were
// already reloaded); "Cobrar a otra familia" starts an empty flow; "Ver el pago" leaves the flow
// for G-05 (12.1: the leader sees the payment right after collecting it).

export default function PaymentDone() {
  const flow = usePaymentFlow();
  const account = useAccount();
  const payment = flow.result;
  if (!payment) return <Redirect href="/common/new-payment/search" />;

  const months = payment.months.map((month) => month.period);
  return (
    <SuccessScreen
      title="Pago registrado"
      message="Copie estos datos en el recibo de papel."
      onDone={() => router.dismissTo(account ? homeHref(account.role) : '/')}
      doneLabel="Listo"
      link={{
        label: 'Ver el pago',
        onPress: () => router.replace(`/common/payments/${payment.id}`),
      }}
      secondary={{
        label: 'Cobrar a otra familia',
        onPress: () => {
          flow.reset();
          router.replace('/common/new-payment/search');
        },
      }}
    >
      {payment.unit?.holder ? <DataRow label="Titular" value={payment.unit.holder} /> : null}
      {months.length > 0 ? <DataRow label="Meses" value={monthsSummary(months)} /> : null}
      {payment.charges.map((charge) => (
        <DataRow key={charge.id} label={charge.feeName} value={formatMoney(charge.amount)} amount />
      ))}
      <DataRow label="Total" value={formatMoney(payment.total)} amount />
      <DataRow label="Recibo" value={payment.paperFolio} />
      <DataRow label="Registro" value={payment.folio} />
    </SuccessScreen>
  );
}
