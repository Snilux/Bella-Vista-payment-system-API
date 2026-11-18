// T-03 · Confirmar entrega
import { formatDate, formatMoney, type Handover } from '@bella-vista/shared';
import { useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { type ReactNode, useCallback, useState } from 'react';
import { describeError } from '../../../../src/api/error-messages.js';
import {
  afterCashMovement,
  confirmHandover,
  useHandover,
} from '../../../../src/api/useCashboxes.js';
import { useMoneyOperation } from '../../../../src/api/useMoneyOperation.js';
import {
  cashboxTitle,
  HANDOVER_TAGS,
  handoverDifference,
  handoverSummary,
} from '../../../../src/features/cashboxes/cashbox-view.js';
import { MoneyFooter } from '../../../../src/features/forms/MoneyFooter.js';
import {
  AmountField,
  AppText,
  Button,
  ConfirmSheet,
  DataRow,
  Header,
  Notice,
  ScreenLayout,
  ScreenState,
  StatusTag,
  SuccessScreen,
  SummaryCard,
  screenStatusOf,
} from '../../../../src/ui/index.js';

// Confirm a handover with the amount counted (Figma T-03; 2.6; D-16). The difference with what
// the leader declared shows while typing; with a shortfall a sheet says what will happen before
// confirming: the block cashbox only goes down by what was received, the committee's goes up by
// the same, and the rest stays in the block cashbox until an adjustment the president authorizes
// (G-11 "Solicitar aclaración", fixed at the whole difference). It goes through
// useMoneyOperation with its Idempotency-Key.

type Vars = { id: number; receivedAmount: number };
type Result = Awaited<ReturnType<typeof confirmHandover>>;

export default function ConfirmHandover() {
  const params = useLocalSearchParams<{ id?: string }>();
  const id = Number(params.id);
  const query = useHandover(id);
  const handover = query.data;
  const header = (
    <Header
      title="Confirmar entrega"
      {...(handover ? { subtitle: whose(handover) } : {})}
      onBack={() => router.back()}
    />
  );
  if (!handover) {
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
  return handover.status === 'pending' ? (
    <ConfirmForm handover={handover} header={header} />
  ) : (
    <HandoverDetail handover={handover} header={header} />
  );
}

const whose = (handover: Handover) =>
  `${handover.preparedBy.fullName} · ${cashboxTitle(handover.cashbox)}`;

function ConfirmForm({ handover, header }: { handover: Handover; header: ReactNode }) {
  const queryClient = useQueryClient();
  const [received, setReceived] = useState<number | null>(null);
  const [asking, setAsking] = useState(false);
  const [missing, setMissing] = useState<string | null>(null);
  const onSuccess = useCallback(() => {
    setAsking(false);
    afterCashMovement(queryClient);
  }, [queryClient]);
  const onFailure = useCallback(() => setAsking(false), []);
  const operation = useMoneyOperation<Vars, Result>(confirmHandover, { onSuccess, onFailure });

  if (operation.status === 'success' && operation.data) {
    return <Confirmed handover={operation.data.handover} />;
  }

  const difference = handoverDifference(handover.declaredAmount, received);
  const failure = operation.status === 'failed' ? describeError(operation.error).message : null;
  const send = () => {
    if (received !== null) void operation.submit({ id: handover.id, receivedAmount: received });
  };
  const confirm = () => {
    if (received === null) {
      setMissing('Escriba el importe que contó.');
      return;
    }
    // A shortfall is confirmed only after reading what it means.
    if (difference.kind === 'shortfall' && operation.status !== 'unknown') setAsking(true);
    else send();
  };

  return (
    <ScreenLayout
      footer={
        <MoneyFooter
          operation={operation}
          label="Confirmar entrega"
          onPress={confirm}
          disabledReason={difference.kind === 'over' ? difference.message : null}
        />
      }
    >
      {header}
      <SummaryCard tone="plain">
        <DataRow label="Folio" value={handover.folio} />
        <DataRow label="Declarado" value={formatMoney(handover.declaredAmount)} amount />
        <DataRow label="Fecha" value={formatDate(handover.date)} />
        {handover.notes ? <DataRow label="Observaciones" value={handover.notes} /> : null}
      </SummaryCard>
      <AmountField
        label="Importe recibido"
        required
        valueCents={received}
        onChangeCents={(cents) => {
          setReceived(cents);
          setMissing(null);
          if (operation.status === 'failed') operation.reset();
        }}
        help="Cuente el efectivo antes de confirmar."
        error={difference.kind === 'over' ? difference.message : missing}
        editable={operation.status !== 'unknown' && !operation.sending}
      />
      {difference.kind === 'shortfall' ? <Notice title={difference.message} /> : null}
      {operation.status === 'unknown' ? <Notice title="No sabemos si se registró." /> : null}
      {failure ? <Notice title={failure} /> : null}
      <ConfirmSheet
        visible={asking}
        title="¿Confirmar con faltante?"
        confirmLabel="Sí, confirmar"
        loading={operation.sending}
        onConfirm={send}
        onCancel={() => setAsking(false)}
      >
        <AppText variant="body">
          {difference.kind === 'shortfall' && received !== null
            ? `Recibió ${formatMoney(received)} de ${formatMoney(handover.declaredAmount)}. La caja del comité sube ${formatMoney(received)} y la de ${cashboxTitle(handover.cashbox)} baja lo mismo. Los ${formatMoney(difference.amount)} que faltan se quedan en la caja del jefe hasta aclararlos con el presidente.`
            : ''}
        </AppText>
      </ConfirmSheet>
    </ScreenLayout>
  );
}

/** After confirming: both effects, and the way to clarify a shortfall. */
function Confirmed({ handover }: { handover: Handover }) {
  const received = handover.receivedAmount ?? 0;
  const shortfall = handover.difference ?? 0;
  return (
    <SuccessScreen
      title={shortfall > 0 ? 'Entrega confirmada con faltante' : 'Entrega confirmada'}
      message={
        shortfall > 0
          ? `La caja del comité subió ${formatMoney(received)} y la de ${cashboxTitle(handover.cashbox)} bajó lo mismo. Faltan ${formatMoney(shortfall)}: siguen en la caja del jefe hasta aclararlos.`
          : `La caja del comité subió ${formatMoney(received)} y la de ${cashboxTitle(handover.cashbox)} bajó lo mismo.`
      }
      onDone={() => router.back()}
      doneLabel="Volver a entregas"
      {...(shortfall > 0
        ? {
            secondary: {
              label: 'Solicitar aclaración',
              onPress: () => requestAdjustment(handover),
            },
          }
        : {})}
    >
      <SummaryCard tone="plain">
        <DataRow label="Folio" value={handover.folio} />
        <DataRow label="Declarado" value={formatMoney(handover.declaredAmount)} amount />
        <DataRow label="Recibido" value={formatMoney(received)} amount />
        {shortfall > 0 ? <DataRow label="Faltante" value={formatMoney(shortfall)} amount /> : null}
      </SummaryCard>
    </SuccessScreen>
  );
}

/** G-11 with the adjustment of this handover (its amount is fixed there). */
function requestAdjustment(handover: Handover) {
  router.push({
    pathname: '/common/approval-request',
    params: {
      type: 'adjustment',
      id: String(handover.id),
      subject: `Entrega ${handover.folio} · faltan ${formatMoney(handover.difference ?? 0)}`,
    },
  });
}

/** A handover already resolved: its data and, with a shortfall, "Solicitar aclaración". */
function HandoverDetail({ handover, header }: { handover: Handover; header: ReactNode }) {
  const tag = HANDOVER_TAGS[handover.status];
  return (
    <ScreenLayout
      {...(handover.status === 'with_difference'
        ? {
            footer: (
              <Button label="Solicitar aclaración" onPress={() => requestAdjustment(handover)} />
            ),
          }
        : {})}
    >
      {header}
      <StatusTag tone={tag.tone} label={tag.label} />
      <SummaryCard tone="plain">
        <DataRow label="Folio" value={handover.folio} />
        <DataRow label="Declarado" value={formatMoney(handover.declaredAmount)} amount />
        <DataRow label="Fecha" value={formatDate(handover.date)} />
        {handover.receivedAmount !== null ? (
          <DataRow label="Recibido" value={formatMoney(handover.receivedAmount)} amount />
        ) : null}
        {handover.difference ? (
          <DataRow label="Faltante" value={formatMoney(handover.difference)} amount />
        ) : null}
        {handover.adjustedAmount !== null ? (
          <DataRow label="Aclarado" value={formatMoney(handover.adjustedAmount)} amount />
        ) : null}
      </SummaryCard>
      <AppText variant="body">{handoverSummary(handover)}</AppText>
      {handover.status === 'with_difference' ? (
        <Notice
          icon="info"
          title="El faltante sigue en la caja del jefe."
          detail="Se aclara una sola vez, por la diferencia completa, con autorización del presidente. Si después aparece el dinero, el jefe prepara una entrega nueva."
        />
      ) : null}
    </ScreenLayout>
  );
}
