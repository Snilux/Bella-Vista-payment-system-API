// J-01 · Inicio

import { formatMoney, formatPeriod } from '@bella-vista/shared';
import { router } from 'expo-router';
import { useMemo } from 'react';
import { useMyCashbox, usePendingHandoverCount } from '../../../src/api/useBilling.js';
import { useBlockRoster } from '../../../src/api/useRegistry.js';
import { firstName } from '../../../src/features/forms/business-date.js';
import { rosterRows } from '../../../src/features/registry/registry-view.js';
import { roleDescription } from '../../../src/session/role-labels.js';
import { useAccount } from '../../../src/session/session-store.js';
import {
  AppText,
  Button,
  DataRow,
  Header,
  MenuGroup,
  MenuRow,
  ScreenLayout,
  ScreenState,
  SummaryCard,
  screenStatusOf,
} from '../../../src/ui/index.js';

// The block leader's home (Figma J-01; 3.2 §10.5): "Debo tener" (the expected balance of the
// block's cashbox), what was collected this month (the block report of the month, the same
// figures as the closings) and the handovers waiting for the treasurer; "Registrar pago" opens
// the Cobrar tab. The pending rows open the roster filtered; "Corte de <mes> por hacer" (the
// month the API says comes next, M8) opens J-05.

export default function BlockLeaderHome() {
  const account = useAccount();
  const cashbox = useMyCashbox();
  const roster = useBlockRoster(account?.blockId ?? null);
  const handovers = usePendingHandoverCount();
  const rows = useMemo(() => (roster.data ? rosterRows(roster.data) : []), [roster.data]);
  const withSurcharge = rows.filter((row) => row.debt.overdueCount > 0).length;
  const withDebt = rows.filter((row) => row.debt.totalDue > 0).length;
  const status = screenStatusOf(cashbox);

  return (
    <ScreenLayout withinTabs>
      <Header
        title={account ? `Hola, ${firstName(account.fullName)}` : 'Inicio'}
        {...(account ? { subtitle: roleDescription(account) } : {})}
      />

      <ScreenState status={status} error={cashbox.error} onRetry={() => void cashbox.refetch()}>
        {cashbox.data ? (
          <SummaryCard heading={{ label: 'Debo tener', amountCents: cashbox.data.balance }}>
            {roster.data ? (
              <DataRow
                label="Cobrado este mes"
                value={formatMoney(roster.data.cashbox.collected)}
                amount
              />
            ) : null}
            {handovers.data ? (
              <DataRow label="Entregas por confirmar" value={String(handovers.data.count)} amount />
            ) : null}
          </SummaryCard>
        ) : null}
      </ScreenState>

      <Button label="Registrar pago" onPress={() => router.navigate('/block_leader/new-payment')} />

      <AppText variant="heading">Pendientes</AppText>
      <MenuGroup>
        <MenuRow
          label="Familias con recargo"
          icon="people"
          {...(roster.data ? { count: withSurcharge } : {})}
          onPress={() =>
            router.navigate({ pathname: '/block_leader/registry', params: { filter: 'surcharge' } })
          }
        />
        <MenuRow
          label="Familias con atraso"
          icon="people"
          {...(roster.data ? { count: withDebt } : {})}
          onPress={() =>
            router.navigate({ pathname: '/block_leader/registry', params: { filter: 'debt' } })
          }
        />
        {cashbox.data?.nextClosingPeriod ? (
          <MenuRow
            label={`Corte de ${formatPeriod(cashbox.data.nextClosingPeriod).toLowerCase()} por hacer`}
            icon="closing"
            onPress={() => router.navigate('/block_leader/my-cashbox/closing')}
          />
        ) : null}
      </MenuGroup>
    </ScreenLayout>
  );
}
