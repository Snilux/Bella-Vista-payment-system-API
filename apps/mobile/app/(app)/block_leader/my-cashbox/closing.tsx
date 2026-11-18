// J-05 · Corte del mes
import { formatPeriod } from '@bella-vista/shared';
import { router } from 'expo-router';
import { describeError } from '../../../../src/api/error-messages.js';
import { useMyCashbox } from '../../../../src/api/useBilling.js';
import { useClosings, useOpenClosing } from '../../../../src/api/useClosings.js';
import { cashboxTitle } from '../../../../src/features/cashboxes/cashbox-view.js';
import { ClosingDetail } from '../../../../src/features/closings/ClosingDetail.js';
import { CLOSING_TAGS, closingTitle } from '../../../../src/features/closings/closing-view.js';
import {
  AppText,
  Button,
  colors,
  Header,
  MenuGroup,
  MenuRow,
  Notice,
  ScreenLayout,
  ScreenState,
  screenStatusOf,
} from '../../../../src/ui/index.js';

// The monthly closing of the leader's cashbox (Figma J-05; 3.2 §10.5; D-14). The month is the
// one the API says comes next (nextClosingPeriod: the month after the last closed one), so the
// closings go in order. Without a closing yet, "Preparar corte" opens it with the API's figures;
// then the leader counts the cash (notes required with a difference) and the president or the
// member review it. Without a finished month to close, it shows the latest closing.

export default function MonthClosing() {
  const cashbox = useMyCashbox();
  const box = cashbox.data;
  const period = box?.nextClosingPeriod ?? null;
  const cashboxId = box?.cashbox.id ?? null;
  const closings = useClosings({ ...(cashboxId ? { cashboxId } : {}) }, cashboxId !== null);
  const open = useOpenClosing();
  const monthly = (closings.data ?? [])
    .filter((item) => item.type === 'monthly')
    .sort((a, b) => b.dateFrom.localeCompare(a.dateFrom));
  const current = period ? monthly.find((item) => item.dateFrom.startsWith(period)) : undefined;
  const latest = monthly[0];

  if (current) {
    return (
      <ClosingDetail
        closing={current}
        header={
          <Header
            title={closingTitle(current)}
            subtitle={`${cashboxTitle(current.cashbox)} · ${CLOSING_TAGS[current.status].label}`}
            onBack={() => router.back()}
          />
        }
      />
    );
  }

  const header = (
    <Header
      title={period ? `Corte de ${formatPeriod(period).toLowerCase()}` : 'Corte del mes'}
      {...(box ? { subtitle: cashboxTitle(box.cashbox) } : {})}
      onBack={() => router.back()}
    />
  );
  const status = cashbox.isError
    ? screenStatusOf(cashbox)
    : closings.isError
      ? screenStatusOf(closings)
      : box && (cashboxId === null || closings.data)
        ? 'ready'
        : 'loading';

  return (
    <ScreenLayout
      {...(period
        ? {
            footer: (
              <Button
                label={`Preparar corte de ${formatPeriod(period).toLowerCase()}`}
                onPress={() => open.mutate({ type: 'monthly', period })}
                loading={open.isPending}
              />
            ),
          }
        : {})}
    >
      {header}
      <ScreenState
        status={status}
        error={cashbox.error ?? closings.error}
        onRetry={() => {
          void cashbox.refetch();
          void closings.refetch();
        }}
      >
        {period ? (
          <AppText variant="body" color={colors.textSecondary}>
            {`La app calcula lo que debe haber en su caja con los movimientos de ${formatPeriod(period).toLowerCase()}; después usted cuenta el efectivo y lo escribe.`}
          </AppText>
        ) : (
          <Notice
            icon="success"
            title="No tiene cortes pendientes."
            detail="El corte de un mes se hace cuando el mes termina."
          />
        )}
        {latest ? (
          <MenuGroup>
            <MenuRow
              label={`Último corte: ${closingTitle(latest).replace('Corte de ', '')} · ${CLOSING_TAGS[latest.status].label}`}
              icon="closing"
              onPress={() => router.push(`/common/closings/${latest.id}`)}
            />
          </MenuGroup>
        ) : null}
        {open.isError ? <Notice title={describeError(open.error).message} /> : null}
      </ScreenState>
    </ScreenLayout>
  );
}
