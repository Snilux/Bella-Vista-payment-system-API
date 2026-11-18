// R-02 · Autorizaciones (lista de un tipo o resueltas)
import { APPROVAL_TYPES, type Approval, formatDateTime } from '@bella-vista/shared';
import { router, useLocalSearchParams } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { useApprovals } from '../../../../src/api/useApprovals.js';
import {
  APPROVAL_STATUS_TAGS,
  APPROVAL_TYPE_TEXTS,
} from '../../../../src/features/approvals/approval-types.js';
import { ROLE_LABELS } from '../../../../src/session/role-labels.js';
import {
  Header,
  RecordCard,
  ScreenLayout,
  ScreenState,
  screenStatusOf,
  spacing,
} from '../../../../src/ui/index.js';

// Opened from R-02: the pending requests of one type (?type=) or the ones already resolved
// (?status=resolved), newest first. Each card opens R-03.

const isType = (value: unknown): value is Approval['type'] =>
  typeof value === 'string' && (APPROVAL_TYPES as readonly string[]).includes(value);

export default function ApprovalList() {
  const params = useLocalSearchParams<{ type?: string; status?: string }>();
  const resolved = params.status === 'resolved';
  const type = isType(params.type) ? params.type : null;
  const query = useApprovals(resolved ? 'resolved' : 'pending');
  const items = (query.data ?? [])
    .filter((item) => resolved || item.type === type)
    .sort((a, b) =>
      resolved ? byDate(b.resolvedAt, a.resolvedAt) : byDate(b.requestedAt, a.requestedAt),
    );
  const status = screenStatusOf(query, () => items.length === 0);

  return (
    <ScreenLayout>
      <Header
        title={
          resolved
            ? 'Resueltas recientemente'
            : type
              ? APPROVAL_TYPE_TEXTS[type].label
              : 'Autorizaciones'
        }
        onBack={() => router.back()}
      />
      <ScreenState
        status={status}
        error={query.error}
        onRetry={() => void query.refetch()}
        empty={{
          message: resolved
            ? 'Todavía no ha resuelto ninguna solicitud.'
            : 'Ya no hay solicitudes pendientes de este tipo.',
          icon: 'approvals',
        }}
      >
        <View style={styles.list}>
          {items.map((item) => (
            <RecordCard
              key={item.id}
              title={item.description ?? APPROVAL_TYPE_TEXTS[item.type].label}
              details={[
                `${APPROVAL_TYPE_TEXTS[item.type].label} · ${formatDateTime(item.requestedAt)}`,
                `Solicita: ${item.requestedBy.fullName} (${ROLE_LABELS[item.requestedBy.role]})`,
              ]}
              tag={APPROVAL_STATUS_TAGS[item.status]}
              accessibilityHint="Abre el detalle de la solicitud"
              onPress={() => router.push(`/president/approvals/${item.id}`)}
            />
          ))}
        </View>
      </ScreenState>
    </ScreenLayout>
  );
}

const byDate = (a: string | null, b: string | null) => (a ?? '').localeCompare(b ?? '');

const styles = StyleSheet.create({ list: { gap: spacing.md } });
