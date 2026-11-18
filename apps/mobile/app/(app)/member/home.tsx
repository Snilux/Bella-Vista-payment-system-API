// V-01 · Inicio del vocal
import { formatMoney } from '@bella-vista/shared';
import { router } from 'expo-router';
import { useCountedClosingCount } from '../../../src/api/useClosings.js';
import { useRefresh } from '../../../src/api/useRefresh.js';
import { useCommunityReport } from '../../../src/api/useReports.js';
import { firstName } from '../../../src/features/forms/business-date.js';
import { useAccount } from '../../../src/session/session-store.js';
import {
  DataRow,
  Header,
  MenuGroup,
  MenuRow,
  ScreenLayout,
  ScreenState,
  SummaryCard,
  screenStatusOf,
} from '../../../src/ui/index.js';

// The member's home (Figma V-01; 3.2 §10.8): consultation only. The community funds and the
// families' debt (the community report of today), the closings to review and the two reports.
// No capture and no authorization: the member reviews closings from G-08 but never closes them.

export default function MemberHome() {
  const refresh = useRefresh();
  const account = useAccount();
  const report = useCommunityReport();
  const closings = useCountedClosingCount();
  const totals = report.data?.totals;
  return (
    <ScreenLayout withinTabs refresh={refresh}>
      <Header
        title={account ? `Hola, ${firstName(account.fullName)}` : 'Inicio'}
        subtitle="Vocal del comité · solo consulta"
      />
      <ScreenState
        status={screenStatusOf(report)}
        error={report.error}
        onRetry={() => void report.refetch()}
      >
        {totals ? (
          <SummaryCard
            heading={{
              label: 'Fondos comunitarios esperados',
              amountCents: totals.expectedCommunityFunds,
            }}
          >
            <DataRow label="Adeudo de familias" value={formatMoney(totals.totalDue)} amount />
          </SummaryCard>
        ) : null}
      </ScreenState>
      <MenuGroup>
        <MenuRow
          label="Cortes por revisar"
          icon="closing"
          {...(closings.data ? { count: closings.data.count } : {})}
          onPress={() => router.navigate('/member/closings')}
        />
        <MenuRow
          label="Reporte comunitario"
          icon="report"
          onPress={() => router.navigate('/member/reports')}
        />
        <MenuRow
          label="Padrón por manzana"
          icon="people"
          onPress={() => router.push('/common/reports/block')}
        />
      </MenuGroup>
    </ScreenLayout>
  );
}
