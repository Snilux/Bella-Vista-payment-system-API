import { formatDate, formatMoney, type Handover, type MyCashbox } from '@bella-vista/shared';
import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useCallback, useState } from 'react';
import { describeError } from '../../api/error-messages.js';
import { useMyCashbox, usePendingHandoverCount } from '../../api/useBilling.js';
import {
  afterCashMovement,
  handoverPages,
  prepareHandover,
  withdrawHandover,
} from '../../api/useCashboxes.js';
import { useMoneyOperation } from '../../api/useMoneyOperation.js';
import { useRefresh } from '../../api/useRefresh.js';
import {
  AmountField,
  AppText,
  Button,
  ConfirmSheet,
  colors,
  DataRow,
  Header,
  MenuGroup,
  MenuRow,
  Notice,
  PaginatedList,
  RecordCard,
  ScreenLayout,
  ScreenState,
  SuccessScreen,
  SummaryCard,
  screenStatusOf,
  TextField,
} from '../../ui/index.js';
import { businessToday } from '../forms/business-date.js';
import { DiscardChangesSheet, useDiscardGuard } from '../forms/DiscardChangesSheet.js';
import { MoneyFooter } from '../forms/MoneyFooter.js';
import {
  HANDOVER_AMOUNT_HELP,
  HANDOVER_TAGS,
  handoverAmountError,
  handoverSummary,
} from './cashbox-view.js';

// The custodian's cashbox, shared by the block leader (J-02 to J-04) and the president's support
// cashbox (R-06): the same API (/cashboxes/mine, /handovers) and the same rules (D-16). `base`
// is where the screens of each role live (their stacks), e.g. "/block_leader/my-cashbox".

/** "Debo tener" with what makes it up. A handover only leaves the cashbox once confirmed. */
export function CashboxCard({ cashbox, support }: { cashbox: MyCashbox; support?: boolean }) {
  const opening = cashbox.openingBalance;
  return (
    <SummaryCard heading={{ label: 'Debo tener', amountCents: cashbox.balance }}>
      {opening?.status === 'approved' ? (
        <DataRow label="Saldo inicial" value={formatMoney(opening.amount)} amount />
      ) : null}
      <DataRow
        label={support ? 'Cobrado en apoyo' : 'Cobrado'}
        value={formatMoney(cashbox.collected)}
        amount
      />
      <DataRow label="Entregado" value={formatMoney(cashbox.handedOver)} amount />
      {cashbox.pendingHandover > 0 ? (
        <DataRow label="Por confirmar" value={formatMoney(cashbox.pendingHandover)} amount />
      ) : null}
    </SummaryCard>
  );
}

/** J-02 and R-06. */
export function MyCashboxScreen({
  title,
  subtitle,
  base,
  support = false,
  withinTabs = false,
  onBack,
}: {
  title: string;
  subtitle?: string;
  base: string;
  support?: boolean;
  withinTabs?: boolean;
  onBack?: () => void;
}) {
  const query = useMyCashbox();
  const pending = usePendingHandoverCount();
  const refresh = useRefresh();
  const cashbox = query.data;
  const header = (
    <Header
      title={title}
      {...(cashbox && cashbox.cashbox.type === 'block'
        ? { subtitle: `Manzana ${cashbox.cashbox.label}` }
        : subtitle
          ? { subtitle }
          : {})}
      {...(onBack ? { onBack } : {})}
    />
  );
  return (
    <ScreenLayout withinTabs={withinTabs} refresh={refresh}>
      {header}
      <ScreenState
        status={screenStatusOf(query)}
        error={query.error}
        onRetry={() => void query.refetch()}
      >
        {cashbox ? (
          <>
            <CashboxCard cashbox={cashbox} support={support} />
            {cashbox.pendingHandover > 0 ? (
              <AppText variant="caption" color={colors.textSecondary}>
                Lo que está por confirmar sigue en su caja hasta que el tesorero cuente el dinero y
                confirme la entrega.
              </AppText>
            ) : null}
            <Button
              label="Preparar entrega"
              onPress={() => router.push(`${base}/new-handover`)}
              disabledReason={
                cashbox.available <= 0
                  ? cashbox.pendingHandover > 0
                    ? 'Todo su efectivo ya está en entregas por confirmar.'
                    : 'No tiene efectivo por entregar.'
                  : null
              }
            />
            <MenuGroup>
              {cashbox.cashbox.id !== null ? (
                <MenuRow
                  label="Movimientos"
                  icon="report"
                  onPress={() => router.push(`/common/cashboxes/${cashbox.cashbox.id}`)}
                />
              ) : null}
              <MenuRow
                label="Mis entregas"
                icon="handover"
                {...(pending.data ? { count: pending.data.count } : {})}
                onPress={() => router.push(`${base}/handovers`)}
              />
              {support ? null : (
                <MenuRow
                  label="Cortes de caja"
                  icon="closing"
                  onPress={() => router.push(`${base}/closing`)}
                />
              )}
            </MenuGroup>
          </>
        ) : null}
      </ScreenState>
    </ScreenLayout>
  );
}

type PrepareVars = { declaredAmount: number; notes?: string };
type HandoverResult = Awaited<ReturnType<typeof prepareHandover>>;

/**
 * J-03 (and the support cashbox of R-06): the declared amount and notes. The date is today's:
 * the API records it, so it is shown and not edited.
 */
export function PrepareHandoverScreen() {
  const queryClient = useQueryClient();
  const query = useMyCashbox();
  const [amount, setAmount] = useState<number | null>(null);
  const [notes, setNotes] = useState('');
  const [missing, setMissing] = useState<string | null>(null);
  const onSuccess = useCallback(() => afterCashMovement(queryClient), [queryClient]);
  const operation = useMoneyOperation<PrepareVars, HandoverResult>(prepareHandover, {
    onSuccess,
  });
  const guard = useDiscardGuard(
    (amount !== null || notes !== '') && operation.status !== 'success',
  );
  const header = <Header title="Preparar entrega" onBack={() => router.back()} />;

  if (operation.status === 'success' && operation.data) {
    const { handover } = operation.data;
    return (
      <SuccessScreen
        title="Entrega preparada"
        message="Entregue el efectivo al tesorero. El importe sigue en su caja hasta que él lo cuente y confirme."
        onDone={() => router.back()}
        doneLabel="Volver a mi caja"
      >
        <SummaryCard tone="plain">
          <DataRow label="Folio" value={handover.folio} />
          <DataRow label="Declarado" value={formatMoney(handover.declaredAmount)} amount />
          <DataRow label="Fecha" value={handover.date} />
        </SummaryCard>
      </SuccessScreen>
    );
  }

  const cashbox = query.data;
  if (!cashbox) {
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

  const tooMuch = handoverAmountError(amount, cashbox);
  const failure = operation.status === 'failed' ? describeError(operation.error).message : null;
  const locked = operation.status === 'unknown' || operation.sending;
  const submit = () => {
    if (amount === null) {
      setMissing('Escriba el importe que va a entregar.');
      return;
    }
    setMissing(null);
    const trimmed = notes.trim();
    void operation.submit({ declaredAmount: amount, ...(trimmed ? { notes: trimmed } : {}) });
  };

  return (
    <ScreenLayout
      footer={
        <MoneyFooter
          operation={operation}
          label="Preparar entrega"
          onPress={submit}
          disabledReason={tooMuch}
        />
      }
    >
      {header}
      <SummaryCard tone="plain">
        <DataRow label="Debo tener" value={formatMoney(cashbox.balance)} amount />
        {cashbox.pendingHandover > 0 ? (
          <DataRow label="Por confirmar" value={formatMoney(cashbox.pendingHandover)} amount />
        ) : null}
        <DataRow label="Puede entregar" value={formatMoney(cashbox.available)} amount />
        <DataRow label="Fecha" value={businessToday()} />
      </SummaryCard>
      <AmountField
        label="Importe a entregar"
        required
        valueCents={amount}
        onChangeCents={(cents) => {
          setAmount(cents);
          setMissing(null);
          if (operation.status === 'failed') operation.reset();
        }}
        help={HANDOVER_AMOUNT_HELP}
        error={tooMuch ?? missing}
        editable={!locked}
      />
      <TextField
        label="Observaciones"
        value={notes}
        onChangeText={setNotes}
        maxLength={500}
        multiline
        editable={!locked}
      />
      <Notice
        icon="info"
        title="El tesorero la confirmará al contar el dinero. Hasta entonces el importe sigue en su caja."
      />
      {operation.status === 'unknown' ? <Notice title="No sabemos si se registró." /> : null}
      {failure ? <Notice title={failure} /> : null}
      <DiscardChangesSheet guard={guard} />
    </ScreenLayout>
  );
}

/** J-04 (and the support cashbox): the custodian's handovers; a pending one can be withdrawn. */
export function MyHandoversScreen({ base }: { base: string }) {
  const queryClient = useQueryClient();
  const [chosen, setChosen] = useState<Handover | null>(null);
  const pages = handoverPages();
  const onSuccess = useCallback(() => {
    setChosen(null);
    afterCashMovement(queryClient);
  }, [queryClient]);
  const withdraw = useMoneyOperation<number, HandoverResult>((id: number) => withdrawHandover(id), {
    idempotent: false,
    onSuccess,
  });
  const failure = withdraw.status === 'failed' ? describeError(withdraw.error).message : null;

  return (
    <ScreenLayout
      scroll={false}
      footer={
        <Button label="Preparar entrega" onPress={() => router.push(`${base}/new-handover`)} />
      }
    >
      <Header title="Mis entregas" onBack={() => router.back()} />
      <PaginatedList
        queryKey={pages.queryKey}
        fetchPage={pages.fetchPage}
        keyExtractor={(item) => String(item.id)}
        renderItem={(item) => (
          <RecordCard
            title={`${item.folio} · ${formatMoney(item.declaredAmount)}`}
            details={[`${formatDate(item.date)} · declarado`, handoverSummary(item)]}
            tag={HANDOVER_TAGS[item.status]}
            {...(item.status === 'pending'
              ? {
                  onPress: () => {
                    withdraw.reset();
                    setChosen(item);
                  },
                  accessibilityHint: 'Abre la opción de retirar la entrega',
                }
              : {})}
          />
        )}
        empty={{ message: 'Aún no ha preparado entregas.' }}
      />
      <ConfirmSheet
        visible={chosen !== null}
        title="¿Retirar la entrega?"
        confirmLabel={withdraw.status === 'unknown' ? 'Reintentar' : 'Sí, retirar'}
        danger
        loading={withdraw.sending}
        onConfirm={() => {
          if (withdraw.status === 'unknown') void withdraw.retry();
          else if (chosen) void withdraw.submit(chosen.id);
        }}
        onCancel={() => setChosen(null)}
      >
        <AppText variant="body">
          {chosen
            ? `${chosen.folio} por ${formatMoney(chosen.declaredAmount)}. El tesorero ya no podrá confirmarla y el importe sigue en su caja. Puede preparar otra cuando quiera.`
            : ''}
        </AppText>
        {withdraw.status === 'unknown' ? (
          <Notice title="No sabemos si se retiró. Toque Reintentar." />
        ) : null}
        {failure ? <Notice title={failure} /> : null}
      </ConfirmSheet>
    </ScreenLayout>
  );
}
