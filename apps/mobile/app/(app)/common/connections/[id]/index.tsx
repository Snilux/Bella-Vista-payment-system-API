// G-03 · Ficha de toma
import { formatDate, formatMoney } from '@bella-vista/shared';
import { router, useLocalSearchParams } from 'expo-router';
import { useConnection } from '../../../../../src/api/useRegistry.js';
import { personLine } from '../../../../../src/features/people/PersonPicker.js';
import { openUnit } from '../../../../../src/features/registry/navigation.js';
import {
  CONNECTION_STATUS_LABELS,
  debtView,
  unitTag,
} from '../../../../../src/features/registry/registry-view.js';
import { useCan } from '../../../../../src/session/permissions.js';
import {
  AppText,
  Button,
  colors,
  DataRow,
  Header,
  ListRow,
  MenuGroup,
  Notice,
  ScreenLayout,
  ScreenState,
  SummaryCard,
  screenStatusOf,
} from '../../../../../src/ui/index.js';

// A connection with its families (Figma G-03; 3.2 §10.2). "Agregar familia" (P-04) only for the
// roles that register families, and only while the connection is active: the API refuses a
// family in a suspended or deactivated one (CONNECTION_NOT_ACTIVE). A family opens G-04 (M6).

export default function ConnectionFile() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const query = useConnection(Number(id));
  const canAdd = useCan('registry.manage');
  const status = screenStatusOf(query);
  const connection = query.data;

  if (status !== 'ready' || !connection) {
    return (
      <ScreenLayout>
        <Header title="Ficha de toma" onBack={() => router.back()} />
        <ScreenState status={status} error={query.error} onRetry={() => void query.refetch()} />
      </ScreenLayout>
    );
  }

  const active = connection.status === 'active';
  const footer =
    canAdd && active ? (
      <>
        <Button
          label="Agregar familia"
          variant="secondary"
          onPress={() =>
            router.push({
              pathname: '/common/connections/[id]/add-unit',
              params: { id: String(connection.id) },
            })
          }
        />
        <AppText variant="caption" color={colors.textSecondary}>
          Agregar una familia no cobra apertura; solo su mensualidad desde el mes de activación.
        </AppText>
      </>
    ) : null;

  return (
    <ScreenLayout {...(footer ? { footer } : {})}>
      <Header
        title={`Toma ${connection.folio}`}
        subtitle={[
          connection.address,
          connection.blockCode ? `Manzana ${connection.blockCode}` : null,
        ]
          .filter(Boolean)
          .join(' · ')}
        onBack={() => router.back()}
      />

      <SummaryCard tone="plain">
        <DataRow label="Estado" value={CONNECTION_STATUS_LABELS[connection.status]} />
        <DataRow label="Activada" value={formatDate(connection.activatedOn)} />
        {connection.deactivatedOn ? (
          <DataRow label="Dada de baja" value={formatDate(connection.deactivatedOn)} />
        ) : null}
        <DataRow label="Familias" value={String(connection.units.length)} amount />
        {connection.totalDue > 0 ? (
          <DataRow label="Deben en total" value={formatMoney(connection.totalDue)} amount />
        ) : null}
      </SummaryCard>

      {connection.status === 'suspended' ? (
        <Notice
          icon="info"
          title="Toma suspendida."
          detail="Mientras esté suspendida no se generan mensualidades; los adeudos anteriores se conservan."
        />
      ) : null}

      <AppText variant="heading">Familias conectadas</AppText>
      {connection.units.length === 0 ? (
        <AppText variant="body">Esta toma todavía no tiene familias.</AppText>
      ) : (
        <MenuGroup>
          {connection.units.map((unit) => (
            <ListRow
              key={unit.id}
              title={`${unit.folio} · ${unit.holder ? personLine(unit.holder) : 'Sin titular'}`}
              subtitle={[unit.reference, debtView(unit.debt).text].filter(Boolean).join(' · ')}
              tag={unitTag(unit.status, unit.debt)}
              onPress={() => openUnit(unit.id)}
            />
          ))}
        </MenuGroup>
      )}
    </ScreenLayout>
  );
}
