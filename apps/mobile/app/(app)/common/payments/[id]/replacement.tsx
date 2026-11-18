// G-10 · Reposición de recibo
import { formatMoney } from '@bella-vista/shared';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { describeError } from '../../../../../src/api/error-messages.js';
import { isApiError } from '../../../../../src/api/errors.js';
import { usePayment, useReplaceReceipt } from '../../../../../src/api/useBilling.js';
import { MISSING_FOLIO, monthsSummary } from '../../../../../src/features/billing/billing-view.js';
import {
  Button,
  DataRow,
  Header,
  Notice,
  ScreenLayout,
  ScreenState,
  SummaryCard,
  screenStatusOf,
  TextField,
} from '../../../../../src/ui/index.js';

// A new paper receipt for a lost one (Figma G-10; 3.2 §10.2; D-23): no cost and no cash movement,
// in the receipt book of the payment's cashbox. A folio already used in that book shows next to
// the field (DUPLICATE_PAPER_FOLIO). A cancelled payment has no replacement.

export default function ReceiptReplacement() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const paymentId = Number(id);
  const query = usePayment(paymentId);
  const replace = useReplaceReceipt(paymentId);
  const [folio, setFolio] = useState('');
  const status = screenStatusOf(query);
  const payment = query.data;

  if (status !== 'ready' || !payment) {
    return (
      <ScreenLayout>
        <Header title="Reposición de recibo" onBack={() => router.back()} />
        <ScreenState status={status} error={query.error} onRetry={() => void query.refetch()} />
      </ScreenLayout>
    );
  }

  const duplicate =
    replace.isError && isApiError(replace.error) && replace.error.code === 'DUPLICATE_PAPER_FOLIO';
  const general = replace.isError && !duplicate ? describeError(replace.error).message : null;
  const original = payment.receipts.find((receipt) => receipt.type === 'original');

  return (
    <ScreenLayout
      {...(payment.cancelled
        ? {}
        : {
            footer: (
              <Button
                label="Guardar reposición"
                onPress={() => replace.mutate(folio.trim(), { onSuccess: () => router.back() })}
                loading={replace.isPending}
                disabledReason={folio.trim() === '' ? MISSING_FOLIO : null}
              />
            ),
          })}
    >
      <Header
        title="Reposición de recibo"
        subtitle={`Pago ${payment.folio}`}
        onBack={() => router.back()}
      />
      <SummaryCard tone="plain">
        {payment.unit?.holder ? <DataRow label="Titular" value={payment.unit.holder} /> : null}
        {payment.months.length > 0 ? (
          <DataRow
            label="Meses"
            value={monthsSummary(payment.months.map((month) => month.period))}
          />
        ) : null}
        <DataRow label="Total" value={formatMoney(payment.total)} amount />
        {original ? <DataRow label="Recibo original" value={original.paperFolio} /> : null}
      </SummaryCard>

      {payment.cancelled ? (
        <Notice title="Este pago está cancelado: no se repone su recibo." />
      ) : (
        <>
          <TextField
            label="Folio del nuevo recibo"
            required
            value={folio}
            onChangeText={(text) => {
              setFolio(text);
              if (replace.isError) replace.reset();
            }}
            help="Escriba REPOSICIÓN en el recibo de papel."
            error={duplicate ? describeError(replace.error).message : null}
            maxLength={30}
          />
          <Notice icon="alert" title="La reposición no tiene costo y no cambia su caja." />
          {general ? <Notice title={general} /> : null}
        </>
      )}
    </ScreenLayout>
  );
}
