// S-01 · Inicio
import { router } from 'expo-router';
import {
  useBlocks,
  useConnectionRequestCount,
  useRoleAssignments,
} from '../../../src/api/useOrganization.js';
import { useCommunityReport } from '../../../src/api/useReports.js';
import { firstName } from '../../../src/features/forms/business-date.js';
import { countLabel, isPending } from '../../../src/features/organization/organization-view.js';
import { useAccount } from '../../../src/session/session-store.js';
import {
  AppText,
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

// The secretary's summary and pending work (Figma S-01; 3.2 §10.7). "Familias activas" adds the
// active families of every block (community report) and "Manzanas" counts the active blocks.
// "Tomas activas" and "Suspensiones vigentes" have no endpoint yet: M5 adds GET /v1/suspensions
// and that figure. "Solicitudes por resolver" opens the Tomas tab (S-02, M5).

export default function SecretaryHome() {
  const account = useAccount();
  const report = useCommunityReport();
  const blocks = useBlocks();
  const assignments = useRoleAssignments();
  const requests = useConnectionRequestCount('requested');

  const status = screenStatusOf(report);
  const activeUnits = report.data?.sections.reduce((sum, item) => sum + item.totals.activeUnits, 0);
  const activeBlocks = blocks.data?.filter((block) => block.active).length;
  const pendingAssignments = assignments.data?.filter(isPending).length;

  return (
    <ScreenLayout withinTabs>
      <Header
        title={account ? `Hola, ${firstName(account.fullName)}` : 'Inicio'}
        subtitle="Secretario del comité"
      />

      <ScreenState status={status} error={report.error} onRetry={() => void report.refetch()}>
        <SummaryCard>
          <DataRow
            label="Familias activas"
            value={activeUnits === undefined ? '—' : String(activeUnits)}
            amount
          />
          <DataRow
            label="Manzanas"
            value={activeBlocks === undefined ? '—' : String(activeBlocks)}
            amount
          />
        </SummaryCard>
      </ScreenState>

      <AppText variant="heading">Pendientes</AppText>
      <MenuGroup>
        <MenuRow
          label="Solicitudes por resolver"
          icon="connection"
          {...(requests.data ? { count: requests.data.count } : {})}
          onPress={() => router.navigate('/secretary/connection-requests')}
        />
        <MenuRow
          label="Asignaciones por confirmar"
          icon="people"
          {...(pendingAssignments === undefined ? {} : { count: pendingAssignments })}
          onPress={() => router.navigate('/secretary/organization/role-assignments')}
        />
      </MenuGroup>
      {requests.data?.more ? (
        <AppText variant="caption" color={colors.textSecondary}>
          {`Hay ${countLabel(requests.data)} solicitudes por resolver.`}
        </AppText>
      ) : null}
    </ScreenLayout>
  );
}
