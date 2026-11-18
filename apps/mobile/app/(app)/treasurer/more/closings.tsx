// T-13 · Cortes
import { type CashboxListItem, type Closing, formatPeriod } from '@bella-vista/shared';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { View } from 'react-native';
import { describeError } from '../../../../src/api/error-messages.js';
import { useCashboxes } from '../../../../src/api/useCashboxes.js';
import { useClosings, useOpenClosing } from '../../../../src/api/useClosings.js';
import { cashboxTitle } from '../../../../src/features/cashboxes/cashbox-view.js';
import {
  CLOSING_TAGS,
  differenceText,
  periodOptions,
  previousPeriod,
} from '../../../../src/features/closings/closing-view.js';
import { businessToday } from '../../../../src/features/forms/business-date.js';
import {
  AppText,
  BottomSheet,
  Button,
  colors,
  Header,
  ListRow,
  MenuGroup,
  MenuRow,
  Notice,
  ScreenLayout,
  ScreenState,
  Select,
  screenStatusOf,
} from '../../../../src/ui/index.js';

// The closings of every cashbox in a month (Figma T-13; 3.2 §10.6; D-08, D-14): one row per
// cashbox with the status of its monthly closing; "Preparar corte del comité" opens the
// committee's (the leaders prepare their own in J-05); "Corte extraordinario" opens the handover
// record of a block cashbox that a leader substitution needs (S-07); the consolidated figures
// are the community report of the month (G-07). Each closing opens G-08.

export default function TreasurerClosings() {
  const lastMonth = previousPeriod(businessToday().slice(0, 7));
  const months = useMemo(() => periodOptions(lastMonth), [lastMonth]);
  const [period, setPeriod] = useState(lastMonth);
  const [extraordinary, setExtraordinary] = useState(false);
  const cashboxes = useCashboxes();
  const closings = useClosings({ period });
  const open = useOpenClosing();
  const status = cashboxes.isError
    ? screenStatusOf(cashboxes)
    : closings.isError
      ? screenStatusOf(closings)
      : cashboxes.data && closings.data
        ? 'ready'
        : 'loading';

  const monthlyOf = (id: number) =>
    closings.data?.find((item) => item.type === 'monthly' && item.cashbox.id === id);
  const committee = cashboxes.data?.find((item) => item.type === 'committee');
  const committeeClosing = committee ? monthlyOf(committee.id) : undefined;
  const extraordinaries = (closings.data ?? []).filter((item) => item.type === 'extraordinary');

  const prepareReason = !committee
    ? null
    : committeeClosing
      ? 'El corte del comité de este mes ya está preparado.'
      : committee.nextClosingPeriod === null
        ? 'La caja del comité no tiene meses terminados por cortar.'
        : committee.nextClosingPeriod !== period
          ? `Primero el corte de ${formatPeriod(committee.nextClosingPeriod).toLowerCase()}: los meses se cortan en orden.`
          : null;

  return (
    <ScreenLayout
      footer={
        <>
          <Button
            label="Preparar corte del comité"
            onPress={() =>
              open.mutate(
                { type: 'monthly', period },
                { onSuccess: ({ closing }) => router.push(`/common/closings/${closing.id}`) },
              )
            }
            loading={open.isPending && !extraordinary}
            disabledReason={prepareReason}
          />
          <Button
            label="Corte extraordinario"
            variant="secondary"
            onPress={() => {
              open.reset();
              setExtraordinary(true);
            }}
          />
        </>
      }
    >
      <Header title="Cortes de caja" subtitle={formatPeriod(period)} onBack={() => router.back()} />
      <Select label="Mes" options={months} value={period} onChange={setPeriod} />
      {open.isError && !extraordinary ? <Notice title={describeError(open.error).message} /> : null}
      <ScreenState
        status={status}
        error={cashboxes.error ?? closings.error}
        onRetry={() => {
          void cashboxes.refetch();
          void closings.refetch();
        }}
      >
        <View>
          {(cashboxes.data ?? []).map((cashbox) => (
            <CashboxRow
              key={cashbox.id}
              cashbox={cashbox}
              period={period}
              closing={monthlyOf(cashbox.id)}
            />
          ))}
        </View>
        <MenuGroup>
          <MenuRow
            label="Consolidado comunitario"
            icon="report"
            onPress={() =>
              router.push({
                pathname: '/common/reports/community',
                params: { from: period, to: period },
              })
            }
          />
        </MenuGroup>
        <AppText variant="caption" color={colors.textSecondary}>
          El consolidado queda completo cuando todas las cajas del mes están cerradas.
        </AppText>
        {extraordinaries.length > 0 ? (
          <>
            <AppText variant="heading">Cortes extraordinarios</AppText>
            <View>
              {extraordinaries.map((item) => (
                <ListRow
                  key={item.id}
                  title={`${cashboxTitle(item.cashbox)} · al ${item.dateTo}`}
                  subtitle={`${item.folio} · ${differenceText(item.difference)}`}
                  tag={CLOSING_TAGS[item.status]}
                  onPress={() => router.push(`/common/closings/${item.id}`)}
                />
              ))}
            </View>
          </>
        ) : null}
      </ScreenState>
      {extraordinary ? (
        <ExtraordinarySheet
          cashboxes={(cashboxes.data ?? []).filter((item) => item.type === 'block')}
          onClose={() => setExtraordinary(false)}
        />
      ) : null}
    </ScreenLayout>
  );
}

function CashboxRow({
  cashbox,
  period,
  closing,
}: {
  cashbox: CashboxListItem;
  period: string;
  closing: Closing | undefined;
}) {
  const subtitle = closing
    ? closing.status === 'closed'
      ? `Cerrado el ${closing.closedAt?.slice(0, 10) ?? ''}`
      : closing.status === 'draft'
        ? 'Preparado, falta contar'
        : `${CLOSING_TAGS[closing.status].label} · ${differenceText(closing.difference).toLowerCase()}`
    : cashbox.nextClosingPeriod !== null && cashbox.nextClosingPeriod < period
      ? `Falta antes el de ${formatPeriod(cashbox.nextClosingPeriod).toLowerCase()}`
      : cashbox.nextClosingPeriod === period
        ? 'Por hacer'
        : 'Sin corte';
  return (
    <ListRow
      title={cashboxTitle(cashbox)}
      subtitle={subtitle}
      {...(closing && closing.status !== 'closed' ? { tag: CLOSING_TAGS[closing.status] } : {})}
      {...(!closing && cashbox.nextClosingPeriod === period
        ? { tag: { tone: 'pending' as const, label: 'Pendiente' } }
        : {})}
      {...(closing ? { onPress: () => router.push(`/common/closings/${closing.id}`) } : {})}
    />
  );
}

/** The handover record of a block cashbox (D-08): from day 1 of this month to today. */
function ExtraordinarySheet({
  cashboxes,
  onClose,
}: {
  cashboxes: CashboxListItem[];
  onClose: () => void;
}) {
  const open = useOpenClosing();
  const [cashboxId, setCashboxId] = useState<number | null>(null);
  return (
    <BottomSheet
      visible
      title="Corte extraordinario"
      onClose={open.isPending ? () => undefined : onClose}
      footer={
        <>
          <Button
            label="Preparar corte extraordinario"
            onPress={() => {
              if (cashboxId === null) return;
              open.mutate(
                { type: 'extraordinary', cashboxId },
                {
                  onSuccess: ({ closing }) => {
                    onClose();
                    router.push(`/common/closings/${closing.id}`);
                  },
                },
              );
            }}
            loading={open.isPending}
            disabledReason={cashboxId === null ? 'Elija la manzana.' : null}
          />
          <Button label="Volver" variant="secondary" onPress={onClose} />
        </>
      }
    >
      <AppText variant="body">
        Es el acta de entrega de una caja de manzana cuando cambia el jefe: cubre del día 1 de este
        mes a hoy. Después cuente el efectivo; con ese conteo el secretario registra al nuevo jefe.
      </AppText>
      <Select
        label="Manzana"
        required
        options={cashboxes.map((item) => ({ value: item.id, label: cashboxTitle(item) }))}
        value={cashboxId}
        onChange={setCashboxId}
        placeholder="Elija la manzana"
      />
      {open.isError ? <Notice title={describeError(open.error).message} /> : null}
    </BottomSheet>
  );
}
