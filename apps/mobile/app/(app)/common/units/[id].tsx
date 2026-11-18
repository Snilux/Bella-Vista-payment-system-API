// G-04 · Familia (estado de cuenta)
import { formatDateTime, formatMoney, formatPeriod } from '@bella-vista/shared';
import { router, useLocalSearchParams } from 'expo-router';
import { useAccountStatement, useUnit } from '../../../../src/api/useBilling.js';
import { monthTag } from '../../../../src/features/billing/billing-view.js';
import { openMonths } from '../../../../src/features/billing/FamilySearch.js';
import { useCan } from '../../../../src/session/permissions.js';
import {
  AppText,
  Button,
  DataRow,
  Header,
  ListRow,
  MenuGroup,
  MenuRow,
  Notice,
  ScreenLayout,
  ScreenState,
  SummaryCard,
  screenStatusOf,
} from '../../../../src/ui/index.js';

// A family and what it owes (Figma G-04; 3.2 §10.2; D-01, D-02, D-06, D-11). The months, their
// status and surcharge come from the API's account statement. "Cobrar" opens F-02 directly (F-01
// is skipped). A suspended or deactivated family says so and offers no "Cobrar". "Solicitar
// baja" and "Cambiar titular" open G-11, unless a request is already waiting for the president.

export default function FamilyFile() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const unitId = Number(id);
  const unit = useUnit(unitId);
  const statement = useAccountStatement(unitId);
  const canCollect = useCan('billing.collect');
  const canRequest = useCan('unitChanges.request');

  const status = unit.isError
    ? screenStatusOf(unit)
    : statement.isError
      ? screenStatusOf(statement)
      : unit.data && statement.data
        ? 'ready'
        : 'loading';
  const family = unit.data;
  const account = statement.data;

  if (status !== 'ready' || !family || !account) {
    return (
      <ScreenLayout>
        <Header title="Familia" onBack={() => router.back()} />
        <ScreenState
          status={status}
          error={unit.error ?? statement.error}
          onRetry={() => {
            void unit.refetch();
            void statement.refetch();
          }}
        />
      </ScreenLayout>
    );
  }

  const active = family.status === 'active';
  const summary = account.summary;
  const months = [...account.months].sort((a, b) => b.period.localeCompare(a.period));
  const subject = `Familia ${family.folio}${family.holder ? ` · ${family.holder.fullName}` : ''}`;
  const request = (type: 'unit_deactivation' | 'holder_change') =>
    router.push({
      pathname: '/common/approval-request',
      params: { type, id: String(family.id), subject },
    });

  return (
    <ScreenLayout>
      <Header
        title={`Familia ${family.folio}`}
        subtitle={[
          family.holder ? `Titular: ${family.holder.fullName}` : 'Sin titular',
          family.connection.address,
        ].join(' · ')}
        onBack={() => router.back()}
      />

      {family.status === 'suspended' ? (
        <Notice
          title="Familia suspendida."
          detail="Mientras dure la suspensión no se generan mensualidades; los adeudos anteriores se conservan."
        />
      ) : family.status === 'deactivated' ? (
        <Notice
          title="Familia dada de baja."
          detail="Ya no se le cobra; su adeudo se conserva con la familia."
        />
      ) : family.status === 'pending_activation' ? (
        <Notice icon="info" title="La familia todavía no está activa." />
      ) : null}

      <SummaryCard heading={{ label: 'Debe', amountCents: summary.totalDue }}>
        {summary.overdueCount > 0 ? (
          <DataRow
            label={summary.surchargeTotal > 0 ? 'Vencidos con recargo' : 'Vencidos'}
            value={String(summary.overdueCount)}
            amount
          />
        ) : null}
        {summary.pendingCount > 0 ? (
          <DataRow label="Pendiente (mes en curso)" value={String(summary.pendingCount)} amount />
        ) : null}
        {summary.advanceCount > 0 ? (
          <DataRow label="Meses adelantados" value={String(summary.advanceCount)} amount />
        ) : null}
      </SummaryCard>

      {canCollect && active ? (
        <Button label="Cobrar" onPress={() => openMonths(family.id)} />
      ) : null}

      {account.missingRatePeriods.length > 0 ? (
        <Notice
          title="Hay meses sin tarifa autorizada."
          detail="No se pueden cobrar hasta que el tesorero registre la tarifa y el presidente la autorice."
        />
      ) : null}

      <AppText variant="heading">Meses</AppText>
      {months.length === 0 ? (
        <AppText variant="body">Todavía no hay meses que cobrar.</AppText>
      ) : (
        <MenuGroup>
          {months.map((month) => {
            const paid = month.paymentId;
            return (
              <ListRow
                key={month.period}
                title={formatPeriod(month.period)}
                tag={monthTag(month)}
                {...(month.total === null
                  ? { subtitle: 'Sin tarifa autorizada' }
                  : { amountCents: month.total })}
                {...(paid !== null
                  ? { onPress: () => router.push(`/common/payments/${paid}`) }
                  : {})}
              />
            );
          })}
        </MenuGroup>
      )}

      {family.payments.length > 0 ? (
        <>
          <AppText variant="heading">Pagos</AppText>
          <MenuGroup>
            {family.payments.map((payment) => (
              <ListRow
                key={payment.id}
                title={payment.folio}
                subtitle={formatDateTime(payment.occurredAt)}
                amountCents={payment.total}
                {...(payment.cancelled ? { tag: { tone: 'cancelled' as const } } : {})}
                onPress={() => router.push(`/common/payments/${payment.id}`)}
              />
            ))}
          </MenuGroup>
        </>
      ) : null}

      {family.pendingChange ? (
        <Notice
          icon="info"
          title={
            family.pendingChange.type === 'deactivation'
              ? 'La baja de esta familia espera la autorización del presidente.'
              : 'El cambio de titular espera la autorización del presidente.'
          }
        />
      ) : canRequest && family.status !== 'deactivated' ? (
        <>
          <AppText variant="heading">Más acciones</AppText>
          <MenuGroup>
            <MenuRow
              label="Solicitar baja"
              icon="people"
              onPress={() => request('unit_deactivation')}
            />
            <MenuRow
              label="Cambiar titular"
              icon="profile"
              onPress={() => request('holder_change')}
            />
          </MenuGroup>
        </>
      ) : null}

      {summary.totalDue > 0 && !active ? (
        <AppText variant="caption">{`Adeudo conservado: ${formatMoney(summary.totalDue)}.`}</AppText>
      ) : null}
    </ScreenLayout>
  );
}
