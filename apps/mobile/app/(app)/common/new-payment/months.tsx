// F-02 · Elegir meses
import {
  canAdvance,
  formatMoney,
  formatPeriod,
  selectableMonths,
  selectionTotal,
  toggleMonth,
} from '@bella-vista/shared';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { useAccountStatement, useUnit } from '../../../../src/api/useBilling.js';
import { useConnectionRequest } from '../../../../src/api/useConnectionRequests.js';
import { useUnitCharges } from '../../../../src/api/useExtraCharges.js';
import { useApprovedRates } from '../../../../src/api/useRegistry.js';
import {
  overdueNotice,
  selectableTag,
  totalLabel,
} from '../../../../src/features/billing/billing-view.js';
import {
  type PaymentTarget,
  usePaymentFlow,
} from '../../../../src/features/billing/PaymentFlow.js';
import {
  AppText,
  Button,
  Checkbox,
  colors,
  DataRow,
  Header,
  MonthRow,
  Notice,
  ScreenLayout,
  ScreenState,
  SummaryCard,
  screenStatusOf,
  spacing,
} from '../../../../src/ui/index.js';

// Choose what to collect (Figma F-02; 3.2 §10.3; D-02, D-03, D-05, D-06). For a family: its
// unpaid months from the account statement (the API says which are overdue and their
// surcharge) and up to 12 advance months priced with the approved rates; the chronological
// selection is the shared domain's (toggleMonth): this screen only paints it. Under the months,
// the family's pending extra charges (reconnection, repair, other; D-28), each one chosen on its
// own and paid in the same payment as the months; a suspended family can still pay them. For the
// opening of a request (from P-06): its opening charge. The fixed bar shows the total and
// "Continuar".

const ADVANCE_MONTHS = 12;

export default function ChooseMonths() {
  const params = useLocalSearchParams<{ unitId?: string; requestId?: string }>();
  const target: PaymentTarget | null = params.requestId
    ? { kind: 'opening', requestId: Number(params.requestId) }
    : params.unitId
      ? { kind: 'unit', unitId: Number(params.unitId) }
      : null;
  const { start } = usePaymentFlow();
  const kind = target?.kind ?? null;
  const id = target ? (target.kind === 'unit' ? target.unitId : target.requestId) : 0;

  useEffect(() => {
    if (kind === 'unit') start({ kind, unitId: id });
    else if (kind === 'opening') start({ kind, requestId: id });
  }, [kind, id, start]);

  if (!target) {
    return (
      <ScreenLayout>
        <Header title="Elegir meses" onBack={() => router.back()} />
        <Notice title="No se indicó a quién cobrar." detail="Vuelva y elija la familia." />
      </ScreenLayout>
    );
  }
  return target.kind === 'unit' ? (
    <UnitMonths unitId={target.unitId} />
  ) : (
    <Opening requestId={target.requestId} />
  );
}

function UnitMonths({ unitId }: { unitId: number }) {
  const flow = usePaymentFlow();
  const unit = useUnit(unitId);
  const statement = useAccountStatement(unitId);
  const rates = useApprovedRates();
  const charges = useUnitCharges(unitId);

  const offer = useMemo(() => {
    if (!statement.data || !rates.data || !unit.data) return null;
    return selectableMonths(statement.data, {
      rates: rates.data.map(({ id, effectivePeriod, amount }) => ({ id, effectivePeriod, amount })),
      advanceCount: ADVANCE_MONTHS,
      suspensions: unit.data.suspensions.map((item) => ({
        from: item.periodFrom,
        to: item.periodTo,
      })),
    });
  }, [statement.data, rates.data, unit.data]);

  const status = unit.isError
    ? screenStatusOf(unit)
    : statement.isError
      ? screenStatusOf(statement)
      : rates.isError
        ? screenStatusOf(rates)
        : charges.isError
          ? screenStatusOf(charges)
          : offer && charges.data
            ? 'ready'
            : 'loading';
  const failedError = unit.error ?? statement.error ?? rates.error ?? charges.error;
  const header = (
    <Header
      title="Elegir meses"
      step={{ current: 2, total: 4 }}
      {...(unit.data
        ? {
            subtitle: [unit.data.holder?.fullName, `Familia ${unit.data.folio}`]
              .filter(Boolean)
              .join(' · '),
          }
        : {})}
      onBack={() => router.back()}
    />
  );

  if (status !== 'ready' || !offer || !unit.data || !statement.data || !charges.data) {
    return (
      <ScreenLayout>
        {header}
        <ScreenState
          status={status}
          error={failedError}
          onRetry={() => {
            void unit.refetch();
            void statement.refetch();
            void rates.refetch();
            void charges.refetch();
          }}
        />
      </ScreenLayout>
    );
  }

  const pending = charges.data;
  const chosenCharges = pending.filter((charge) => flow.chargeIds.includes(charge.id));
  const chargesTotal = chosenCharges.reduce((sum, charge) => sum + charge.amount, 0);
  const locked = flow.hasUnansweredAttempt;
  const toggleCharge = (id: number) => {
    if (locked) return;
    flow.setChargeIds(
      flow.chargeIds.includes(id)
        ? flow.chargeIds.filter((item) => item !== id)
        : [...flow.chargeIds, id],
    );
  };
  const chargeList =
    pending.length > 0 ? (
      <View style={styles.list}>
        <AppText variant="heading">Conceptos pendientes</AppText>
        {pending.map((charge) => (
          <Checkbox
            key={charge.id}
            label={`${charge.fee.name} · ${formatMoney(charge.amount)}`}
            description={`Cargado el ${charge.chargedOn}${charge.target === 'connection' ? ' · a la toma' : ''}`}
            checked={flow.chargeIds.includes(charge.id)}
            onChange={() => toggleCharge(charge.id)}
          />
        ))}
      </View>
    ) : null;
  const totalBar = (monthsTotal: number, monthCount: number) => (
    <>
      <View style={styles.totalRow}>
        <AppText variant="body" color={colors.textSecondary} style={styles.flex}>
          {totalLabel(monthCount, chosenCharges.length)}
        </AppText>
        <AppText variant="title" amount>
          {formatMoney(monthsTotal + chargesTotal)}
        </AppText>
      </View>
      <Button
        label="Continuar"
        onPress={() => router.push('/common/new-payment/review')}
        disabledReason={
          monthCount === 0 && chosenCharges.length === 0 && !locked
            ? pending.length > 0
              ? 'Elija al menos un mes o un concepto.'
              : 'Elija al menos un mes.'
            : null
        }
      />
    </>
  );

  if (unit.data.status !== 'active') {
    return (
      <ScreenLayout {...(pending.length > 0 ? { footer: totalBar(0, 0) } : {})}>
        {header}
        <Notice
          title={
            unit.data.status === 'suspended'
              ? 'Familia suspendida: mientras dure no se generan mensualidades ni se cobra.'
              : unit.data.status === 'deactivated'
                ? 'Familia dada de baja: ya no se le cobra; su adeudo se conserva.'
                : 'La familia todavía no está activa.'
          }
          {...(pending.length > 0 ? { detail: 'Puede cobrarle sus conceptos pendientes.' } : {})}
        />
        {chargeList}
      </ScreenLayout>
    );
  }

  const months = offer.months;
  const due = months.filter((month) => month.kind !== 'advance');
  const advances = months.filter((month) => month.kind === 'advance');
  const advancing = canAdvance(months, flow.periods);
  const total = selectionTotal(months, flow.periods);
  const notice = overdueNotice(statement.data.summary);
  const toggle = (period: string) => {
    if (!locked) flow.setPeriods(toggleMonth(months, flow.periods, period));
  };

  return (
    <ScreenLayout footer={totalBar(total, flow.periods.length)}>
      {header}
      {flow.notice ? <Notice title={flow.notice} /> : null}
      {locked ? (
        <Notice
          title="Hay un pago que no sabemos si se registró."
          detail="Continúe y toque Reintentar: si ya se había registrado, no se duplica."
        />
      ) : null}
      {notice ? <Notice title={notice} /> : null}

      {due.length === 0 ? (
        <Notice
          icon="success"
          title="La familia está al corriente."
          detail="Puede adelantar meses."
        />
      ) : (
        <View style={styles.list}>
          {due.map((month) => (
            <MonthRow
              key={month.period}
              period={month.period}
              tone={selectableTag(month).tone}
              baseCents={month.baseAmount}
              surchargeCents={month.surcharge}
              totalCents={month.total}
              checked={flow.periods.includes(month.period)}
              onToggle={() => toggle(month.period)}
              disabled={locked}
            />
          ))}
        </View>
      )}

      {offer.blockedFrom ? (
        <Notice
          title={`Desde ${formatPeriod(offer.blockedFrom).toLowerCase()} no hay tarifa autorizada.`}
          detail="Esos meses todavía no se pueden cobrar: el tesorero debe registrar la tarifa."
        />
      ) : null}

      {advances.length > 0 ? (
        <View style={styles.list}>
          <AppText variant="heading">Adelantar meses</AppText>
          {!advancing ? (
            <AppText variant="caption" color={colors.textSecondary}>
              Disponible al marcar todos los meses vencidos y el del mes en curso.
            </AppText>
          ) : null}
          {advances.map((month) => (
            <MonthRow
              key={month.period}
              period={month.period}
              tone="advance"
              baseCents={month.baseAmount}
              surchargeCents={0}
              totalCents={month.total}
              checked={flow.periods.includes(month.period)}
              onToggle={() => toggle(month.period)}
              disabled={locked || !advancing}
            />
          ))}
        </View>
      ) : null}

      {chargeList}
    </ScreenLayout>
  );
}

/** F-02 for the opening of an approved request (from P-06): its opening charge. */
function Opening({ requestId }: { requestId: number }) {
  const flow = usePaymentFlow();
  const query = useConnectionRequest(requestId);
  const request = query.data;
  const charge =
    request?.status === 'approved_pending_payment' && request.openingCharge?.cancelledOn === null
      ? request.openingCharge
      : null;

  const status = screenStatusOf(query);
  const header = (
    <Header
      title="Cobrar apertura"
      step={{ current: 2, total: 4 }}
      {...(request
        ? { subtitle: `Solicitud ${request.folio} · ${request.applicant.fullName}` }
        : {})}
      onBack={() => router.back()}
    />
  );
  if (status !== 'ready' || !request) {
    return (
      <ScreenLayout>
        {header}
        <ScreenState status={status} error={query.error} onRetry={() => void query.refetch()} />
      </ScreenLayout>
    );
  }
  if (!charge) {
    return (
      <ScreenLayout>
        {header}
        <Notice
          icon="info"
          title="Esta solicitud no tiene una apertura por cobrar."
          detail="Solo se cobra la apertura de una solicitud aprobada que aún no está pagada."
        />
      </ScreenLayout>
    );
  }
  return (
    <ScreenLayout
      footer={
        <>
          <View style={styles.totalRow}>
            <AppText variant="body" color={colors.textSecondary} style={styles.flex}>
              {totalLabel(0, 1)}
            </AppText>
            <AppText variant="title" amount>
              {formatMoney(charge.amount)}
            </AppText>
          </View>
          <Button
            label="Continuar"
            onPress={() => {
              // The opening is the only thing paid in this flow.
              flow.setChargeIds([charge.id]);
              router.push('/common/new-payment/review');
            }}
          />
        </>
      }
    >
      {header}
      {flow.notice ? <Notice title={flow.notice} /> : null}
      <SummaryCard tone="plain">
        <DataRow label="Concepto" value={charge.feeName} />
        <DataRow label="Importe" value={formatMoney(charge.amount)} amount />
        <DataRow label="Dirección" value={`${request.address} · ${request.blockCode}`} />
      </SummaryCard>
      <AppText variant="caption" color={colors.textSecondary}>
        El importe quedó fijo al aprobarse la solicitud. Al pagarla, la toma se puede instalar.
      </AppText>
    </ScreenLayout>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.md },
  totalRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, flexWrap: 'wrap' },
  flex: { flex: 1, minWidth: 120 },
});
