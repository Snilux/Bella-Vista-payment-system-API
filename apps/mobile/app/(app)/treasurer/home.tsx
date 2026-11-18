// T-01 · Inicio
import { formatMoney } from '@bella-vista/shared';
import { router } from 'expo-router';
import { useMyCashbox, usePendingHandoverCount } from '../../../src/api/useBilling.js';
import { useCashboxes } from '../../../src/api/useCashboxes.js';
import { useExpenses } from '../../../src/api/useCommittee.js';
import { firstName } from '../../../src/features/forms/business-date.js';
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

// The treasurer's home (Figma T-01; 3.2 §10.6): the committee cashbox, the cash still held by
// the block leaders (and the president's support cashbox) and the whole community fund; the
// handovers to confirm and the expenses to pay. "Corte del mes por hacer" arrives with the
// closings (M8).

export default function TreasurerHome() {
  const account = useAccount();
  const cashbox = useMyCashbox();
  const all = useCashboxes();
  const handovers = usePendingHandoverCount();
  const expenses = useExpenses('pending_payment');
  const withLeaders = (all.data ?? [])
    .filter((item) => item.type !== 'committee')
    .reduce((sum, item) => sum + item.balance, 0);
  const pendingHandovers = handovers.data?.count ?? 0;

  return (
    <ScreenLayout withinTabs>
      <Header
        title={account ? `Hola, ${firstName(account.fullName)}` : 'Inicio'}
        {...(account ? { subtitle: roleDescription(account) } : {})}
      />
      <ScreenState
        status={screenStatusOf(cashbox)}
        error={cashbox.error}
        onRetry={() => void cashbox.refetch()}
      >
        {cashbox.data ? (
          <SummaryCard heading={{ label: 'Caja del comité', amountCents: cashbox.data.balance }}>
            {all.data ? (
              <>
                <DataRow label="Efectivo con jefes" value={formatMoney(withLeaders)} amount />
                <DataRow
                  label="Fondos comunitarios"
                  value={formatMoney(withLeaders + cashbox.data.balance)}
                  amount
                />
              </>
            ) : null}
          </SummaryCard>
        ) : null}
      </ScreenState>

      <Button
        label={
          pendingHandovers > 0 ? `Confirmar entregas (${pendingHandovers})` : 'Confirmar entregas'
        }
        onPress={() => router.navigate('/treasurer/handovers')}
      />

      <AppText variant="heading">Pendientes</AppText>
      <MenuGroup>
        <MenuRow
          label="Entregas por confirmar"
          icon="handover"
          {...(handovers.data ? { count: handovers.data.count } : {})}
          onPress={() => router.navigate('/treasurer/handovers')}
        />
        <MenuRow
          label="Gastos por pagar"
          icon="fees"
          {...(expenses.data ? { count: expenses.data.expenses.length } : {})}
          onPress={() => router.navigate('/treasurer/cashbox')}
        />
      </MenuGroup>
    </ScreenLayout>
  );
}
