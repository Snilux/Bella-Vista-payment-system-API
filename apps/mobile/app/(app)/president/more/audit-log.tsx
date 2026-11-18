// R-05 · Bitácora
import { type AuditEntry, ROLES, type Role } from '@bella-vista/shared';
import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { queryKeys } from '../../../../src/api/keys.js';
import { type AuditLogFilter, useAuditLogPages } from '../../../../src/api/useAuditLog.js';
import {
  AUDIT_ACTION_LABELS,
  AUDIT_TABLE_CHIPS,
  AUDIT_TABLE_LABELS,
  auditChanges,
  auditRow,
} from '../../../../src/features/audit/audit-view.js';
import { ROLE_LABELS } from '../../../../src/session/role-labels.js';
import {
  AppText,
  BottomSheet,
  Button,
  Chip,
  colors,
  DataRow,
  DateField,
  dateError,
  Header,
  ListRow,
  PaginatedList,
  ScreenLayout,
  Select,
  SummaryCard,
  spacing,
} from '../../../../src/ui/index.js';

// Who did each operation (Figma R-05; CU-25, RF-AUD-02): the whole log for the president,
// newest first and paginated, filtered by table (chips), dates (AAAA-MM-DD), role and action.
// Each entry opens its detail: who, when, the reason and the fields it changed, never a password,
// token or key.

const ALL = 'all';

export default function AuditLog() {
  const [table, setTable] = useState<string | undefined>(undefined);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [role, setRole] = useState<Role | typeof ALL>(ALL);
  const [action, setAction] = useState<string>(ALL);
  const [chosen, setChosen] = useState<AuditEntry | null>(null);

  const fromError = dateError(from);
  const toError =
    dateError(to) ?? (from && to && to < from ? 'Debe ser igual o posterior a «Desde».' : null);
  // Only valid dates filter: while one is half written the list keeps the previous filter.
  const filter: AuditLogFilter = {
    ...(table ? { tableName: table } : {}),
    ...(from && !fromError ? { from } : {}),
    ...(to && !toError ? { to } : {}),
    ...(role !== ALL ? { role } : {}),
    ...(action !== ALL ? { action } : {}),
  };
  const fetchPage = useAuditLogPages(filter);

  return (
    <ScreenLayout scroll={false}>
      <PaginatedList
        queryKey={queryKeys.auditLogFiltered(filter)}
        fetchPage={fetchPage}
        keyExtractor={(item) => String(item.id)}
        header={
          <View style={styles.header}>
            <Header
              title="Bitácora"
              subtitle="Quién hizo cada operación"
              onBack={() => router.back()}
            />
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.chips}
            >
              {AUDIT_TABLE_CHIPS.map((chip) => (
                <Chip
                  key={chip.label}
                  label={chip.label}
                  selected={table === chip.tableName}
                  onPress={() => setTable(chip.tableName)}
                />
              ))}
            </ScrollView>
            <View style={styles.row}>
              <View style={styles.field}>
                <DateField
                  label="Desde"
                  value={from}
                  onChange={setFrom}
                  error={from ? fromError : null}
                />
              </View>
              <View style={styles.field}>
                <DateField label="Hasta" value={to} onChange={setTo} error={to ? toError : null} />
              </View>
            </View>
            <View style={styles.row}>
              <View style={styles.field}>
                <Select
                  label="Cargo"
                  options={[
                    { value: ALL, label: 'Todos' },
                    ...ROLES.map((item) => ({ value: item, label: ROLE_LABELS[item] })),
                  ]}
                  value={role}
                  onChange={(value) => setRole(value as Role | typeof ALL)}
                />
              </View>
              <View style={styles.field}>
                <Select
                  label="Acción"
                  options={[
                    { value: ALL, label: 'Todas' },
                    ...Object.entries(AUDIT_ACTION_LABELS).map(([value, label]) => ({
                      value,
                      label,
                    })),
                  ]}
                  value={action}
                  onChange={setAction}
                />
              </View>
            </View>
          </View>
        }
        renderItem={(item) => {
          const row = auditRow(item);
          return (
            <ListRow title={row.title} subtitle={row.subtitle} onPress={() => setChosen(item)} />
          );
        }}
        empty={{ message: 'No hay operaciones con esos filtros.' }}
      />
      {chosen ? <EntrySheet entry={chosen} onClose={() => setChosen(null)} /> : null}
    </ScreenLayout>
  );
}

function EntrySheet({ entry, onClose }: { entry: AuditEntry; onClose: () => void }) {
  const row = auditRow(entry);
  const changes = auditChanges(entry);
  return (
    <BottomSheet
      visible
      title={row.title}
      onClose={onClose}
      footer={<Button label="Cerrar" variant="secondary" onPress={onClose} />}
    >
      <SummaryCard tone="plain">
        <DataRow label="Quién" value={`${entry.fullName} (${entry.username})`} />
        <DataRow label="Cargo" value={ROLE_LABELS[entry.role as Role] ?? entry.role} />
        <DataRow label="Cuándo" value={row.subtitle.split(' · ').at(-1) ?? ''} />
        <DataRow
          label="Registro"
          value={`${AUDIT_TABLE_LABELS[entry.tableName] ?? entry.tableName} ${entry.recordId}`}
        />
        {entry.reason ? <DataRow label="Motivo" value={entry.reason} /> : null}
      </SummaryCard>
      {changes.length > 0 ? (
        <SummaryCard tone="plain">
          {changes.map((change) => (
            <DataRow
              key={change.field}
              label={change.field}
              value={change.before === '—' ? change.after : `${change.before} → ${change.after}`}
            />
          ))}
        </SummaryCard>
      ) : (
        <AppText variant="caption" color={colors.textSecondary}>
          Sin datos de antes y después.
        </AppText>
      )}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  header: { gap: spacing.md, paddingBottom: spacing.md },
  chips: { gap: spacing.sm },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  field: { flex: 1, minWidth: 150 },
});
