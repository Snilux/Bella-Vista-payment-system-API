// R-01 · Inicio del presidente
import { formatMoney } from '@bella-vista/shared';
import { router } from 'expo-router';
import { useApprovals } from '../../../src/api/useApprovals.js';
import { useCountedClosingCount } from '../../../src/api/useClosings.js';
import { useCommunityReport } from '../../../src/api/useReports.js';
import { firstName } from '../../../src/features/forms/business-date.js';
import { countLabel } from '../../../src/features/organization/organization-view.js';
import { useAccount } from '../../../src/session/session-store.js';
import {
  AppText,
  Button,
  colors,
  DataRow,
  Header,
  MenuGroup,
  MenuRow,
  ScreenLayout,
  ScreenState,
  SummaryCard,
  screenStatusOf,
} from '../../../src/ui/index.js';

// Community summary and what waits for the president (2.5; 3.2 §10.8). Every figure comes from
// the API: the totals of the community report (balances and debt of today) and the pending
// approvals. "Cortes por revisar" counts the counted closings and opens R-04; "Reporte
// comunitario" opens G-07 (both are tabs of the president).

export default function PresidentHome() {
  const account = useAccount();
  const report = useCommunityReport();
  const approvals = useApprovals('pending');
  const closings = useCountedClosingCount();
  const status = screenStatusOf(report);
  const totals = report.data?.totals;
  const pending = approvals.data?.length ?? null;

  return (
    <ScreenLayout withinTabs>
      <Header
        title={account ? `Hola, ${firstName(account.fullName)}` : 'Inicio'}
        subtitle="Presidente del comité"
      />

      <ScreenState status={status} error={report.error} onRetry={() => void report.refetch()}>
        {totals ? (
          <SummaryCard
            heading={{
              label: 'Fondos comunitarios esperados',
              amountCents: totals.expectedCommunityFunds,
            }}
          >
            <DataRow label="Caja del comité" value={formatMoney(totals.committeeBalance)} amount />
            <DataRow
              label="Efectivo con jefes"
              value={formatMoney(totals.cashWithLeaders)}
              amount
            />
            {totals.cashInSupport !== 0 ? (
              <DataRow label="Cajas de apoyo" value={formatMoney(totals.cashInSupport)} amount />
            ) : null}
            <DataRow label="Adeudo de familias" value={formatMoney(totals.totalDue)} amount />
          </SummaryCard>
        ) : null}
      </ScreenState>

      <Button
        label={pending === null ? 'Revisar autorizaciones' : `Revisar autorizaciones (${pending})`}
        onPress={() => router.navigate('/president/approvals')}
      />

      <MenuGroup>
        <MenuRow
          label="Cortes por revisar"
          icon="closing"
          {...(closings.data ? { count: closings.data.count } : {})}
          onPress={() => router.navigate('/president/closings')}
        />
        <MenuRow
          label="Reporte comunitario"
          icon="report"
          onPress={() => router.navigate('/president/reports')}
        />
      </MenuGroup>
      {closings.data?.more ? (
        <AppText variant="caption" color={colors.textSecondary}>
          {`Hay ${countLabel(closings.data)} cortes por revisar.`}
        </AppText>
      ) : null}
    </ScreenLayout>
  );
}
