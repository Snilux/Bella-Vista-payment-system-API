// F-03 · Revisar y folio
import {
  type CreatePaymentRequest,
  createPaymentRequestSchema,
  formatMoney,
  type PaymentPreviewRequest,
} from '@bella-vista/shared';
import { useQueryClient } from '@tanstack/react-query';
import { Redirect, router } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { describeError, UNKNOWN_OUTCOME_MESSAGE } from '../../../../src/api/error-messages.js';
import { isApiError } from '../../../../src/api/errors.js';
import { queryKeys } from '../../../../src/api/keys.js';
import {
  afterPayment,
  registerPayment,
  usePaymentPreview,
  useUnit,
} from '../../../../src/api/useBilling.js';
import { useMoneyOperation } from '../../../../src/api/useMoneyOperation.js';
import {
  MISSING_FOLIO,
  monthsSummary,
  uniformRate,
} from '../../../../src/features/billing/billing-view.js';
import { usePaymentFlow } from '../../../../src/features/billing/PaymentFlow.js';
import {
  AppText,
  Button,
  colors,
  DataRow,
  Header,
  Notice,
  ScreenLayout,
  ScreenState,
  SummaryCard,
  screenStatusOf,
  TextField,
} from '../../../../src/ui/index.js';

// Review and paper folio (Figma F-03; 3.2 §10.3 and §3.3). The summary is the API's preview: its
// total is what the person sees and what goes as expectedTotal. "Registrar pago" goes through
// useMoneyOperation: the Idempotency-Key is created on the tap and kept in the flow context
// until an answer arrives, the button says "Guardando..." and a second tap sends nothing. With
// no answer: "No sabemos si se registró" and "Reintentar" with the same key. TOTAL_CHANGED (or
// a month already paid, or out of order) goes back to F-02 with the notice; a repeated paper
// folio (DUPLICATE_PAPER_FOLIO) shows next to its field.

type PaymentResult = Awaited<ReturnType<typeof registerPayment>>;

export default function ReviewPayment() {
  const flow = usePaymentFlow();
  const queryClient = useQueryClient();
  const [folioError, setFolioError] = useState<string | null>(null);
  const target = flow.target;

  const body = useMemo<PaymentPreviewRequest | null>(() => {
    if (!target) return null;
    if (target.kind === 'unit') {
      return flow.periods.length > 0
        ? { unitId: target.unitId, periods: flow.periods, extraChargeIds: [] }
        : null;
    }
    return flow.chargeIds.length > 0 ? { periods: [], extraChargeIds: flow.chargeIds } : null;
  }, [target, flow.periods, flow.chargeIds]);

  const preview = usePaymentPreview(flow.hasUnansweredAttempt ? null : body);
  const unit = useUnit(target?.kind === 'unit' ? target.unitId : 0);

  const { finish, setNotice } = flow;
  const onSuccess = useCallback(
    ({ payment }: PaymentResult) => {
      afterPayment(queryClient);
      finish(payment);
      router.replace('/common/new-payment/done');
    },
    [queryClient, finish],
  );
  // The API refused the summary (TOTAL_CHANGED, a month paid meanwhile, out of order): back to
  // F-02 with the reason; the statement reloads with the new amounts.
  const onFailure = useCallback(
    (error: unknown) => {
      const described = describeError(error);
      if (described.action !== 'back-to-months') return;
      setNotice(described.message);
      void queryClient.invalidateQueries({ queryKey: queryKeys.units });
      router.back();
    },
    [queryClient, setNotice],
  );
  const operation = useMoneyOperation<CreatePaymentRequest, PaymentResult>(registerPayment, {
    attemptStore: flow.attempt,
    onSuccess,
    onFailure,
  });
  const failure = operation.status === 'failed' ? describeError(operation.error) : null;
  const backToMonths = failure?.action === 'back-to-months';

  if (!target) return <Redirect href="/common/new-payment/search" />;

  const duplicateFolio =
    operation.status === 'failed' &&
    isApiError(operation.error) &&
    operation.error.code === 'DUPLICATE_PAPER_FOLIO';
  const otherError = failure && !backToMonths && !duplicateFolio ? failure.message : null;
  const unknown = operation.status === 'unknown';
  const summary = preview.data;
  const status = flow.hasUnansweredAttempt && !summary ? 'ready' : screenStatusOf(preview);

  const register = () => {
    if (!summary || !body) return;
    const parsed = createPaymentRequestSchema.safeParse({
      ...body,
      paperFolio: flow.paperFolio,
      expectedTotal: summary.total,
    });
    if (!parsed.success) {
      setFolioError(MISSING_FOLIO);
      return;
    }
    setFolioError(null);
    void operation.submit(parsed.data);
  };

  const footer = unknown ? (
    <>
      <Button
        label="Reintentar"
        onPress={() => void operation.retry()}
        loading={operation.sending}
      />
      <AppText variant="caption" color={colors.textSecondary}>
        {UNKNOWN_OUTCOME_MESSAGE}
      </AppText>
    </>
  ) : (
    <>
      <Button
        label="Registrar pago"
        onPress={register}
        loading={operation.sending}
        disabledReason={
          !summary
            ? 'Espere a que se calcule el total.'
            : flow.paperFolio.trim() === ''
              ? MISSING_FOLIO
              : null
        }
      />
      <Button
        label="Volver"
        variant="secondary"
        onPress={() => router.back()}
        disabledReason={operation.sending ? 'Espere a que termine de guardar.' : null}
      />
    </>
  );

  const months = summary?.months ?? [];
  const surcharge = months.reduce((sum, month) => sum + month.surcharge, 0);
  const rate = uniformRate(months);

  return (
    <ScreenLayout footer={footer}>
      <Header
        title="Revise el pago"
        step={{ current: 3, total: 4 }}
        {...(operation.sending ? {} : { onBack: () => router.back() })}
      />

      {unknown ? (
        <Notice
          title="No sabemos si se registró."
          detail="Toque Reintentar con los mismos datos."
        />
      ) : null}

      {summary ? (
        <SummaryCard total={{ label: 'Total', amountCents: summary.total }}>
          {summary.unit?.holder ? <DataRow label="Titular" value={summary.unit.holder} /> : null}
          {summary.unit ? (
            <DataRow
              label="Familia"
              value={[summary.unit.folio, unit.data?.connection.folio].filter(Boolean).join(' · ')}
            />
          ) : null}
          {months.length > 0 ? (
            <DataRow label="Meses" value={monthsSummary(months.map((month) => month.period))} />
          ) : null}
          {rate ? <DataRow label="Tarifa" value={rate} /> : null}
          {surcharge > 0 ? <DataRow label="Recargo" value={formatMoney(surcharge)} amount /> : null}
          {summary.charges.map((charge) => (
            <DataRow
              key={charge.id}
              label={charge.feeName}
              value={formatMoney(charge.amount)}
              amount
            />
          ))}
          <DataRow
            label="Recibe"
            value={
              summary.cashbox.type === 'block'
                ? `Caja ${summary.cashbox.label}`
                : summary.cashbox.label
            }
          />
        </SummaryCard>
      ) : (
        <ScreenState status={status} error={preview.error} onRetry={() => void preview.refetch()} />
      )}

      <TextField
        label="Folio del recibo de papel"
        required
        value={flow.paperFolio}
        onChangeText={(text) => {
          flow.setPaperFolio(text);
          setFolioError(null);
          if (duplicateFolio) operation.reset();
        }}
        help="Escríbalo como aparece en el talonario."
        error={duplicateFolio ? describeError(operation.error).message : folioError}
        editable={!unknown && !operation.sending}
        maxLength={30}
      />
      {otherError ? <Notice title={otherError} /> : null}
    </ScreenLayout>
  );
}
