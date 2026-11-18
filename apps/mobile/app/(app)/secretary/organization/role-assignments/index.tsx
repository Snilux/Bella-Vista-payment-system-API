// S-07 · Cargos y jefes
import { formatDate, type RoleAssignment } from '@bella-vista/shared';
import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { useRoleAssignments } from '../../../../../src/api/useOrganization.js';
import {
  ASSIGNMENT_TAGS,
  assignmentGroups,
  assignmentTitle,
} from '../../../../../src/features/organization/organization-view.js';
import { useCan } from '../../../../../src/session/permissions.js';
import {
  AppText,
  Button,
  Header,
  ListRow,
  MenuGroup,
  ScreenLayout,
  ScreenState,
  screenStatusOf,
  spacing,
} from '../../../../../src/ui/index.js';

// Current assignments: the committee officers and the block leaders, with the ones waiting for
// the president marked "Pendiente" (Figma S-07; 3.2 §10.7). "Asignar cargo" registers any
// committee role or a block leader; "Sustituir jefe" relieves a leader with the handover record
// (D-08). Both go to the president as a role_assignment approval. A current leader's row opens
// the substitution of that block.

export default function RoleAssignments() {
  const query = useRoleAssignments();
  const canRegister = useCan('assignments.register');
  const groups = assignmentGroups(query.data ?? []);
  const status = screenStatusOf(
    query,
    () => groups.committee.length === 0 && groups.leaders.length === 0,
  );

  const footer = canRegister ? (
    <>
      <Button
        label="Asignar cargo"
        onPress={() => router.push('/secretary/organization/role-assignments/new')}
      />
      <Button
        label="Sustituir jefe"
        variant="secondary"
        onPress={() => router.push('/secretary/organization/role-assignments/substitution')}
      />
    </>
  ) : null;

  return (
    <ScreenLayout {...(footer ? { footer } : {})}>
      <Header
        title="Cargos y jefes"
        subtitle="Asignaciones vigentes"
        onBack={() => router.back()}
      />
      <ScreenState
        status={status}
        error={query.error}
        onRetry={() => void query.refetch()}
        empty={{ message: 'Todavía no hay cargos asignados.', icon: 'people' }}
      >
        <View style={styles.groups}>
          {groups.committee.length > 0 ? (
            <View style={styles.group}>
              <AppText variant="heading">Comité</AppText>
              <MenuGroup>
                {groups.committee.map((item) => (
                  <AssignmentRow key={item.id} assignment={item} />
                ))}
              </MenuGroup>
            </View>
          ) : null}
          {groups.leaders.length > 0 ? (
            <View style={styles.group}>
              <AppText variant="heading">Jefes de manzana</AppText>
              <MenuGroup>
                {groups.leaders.map((item) => (
                  <AssignmentRow
                    key={item.id}
                    assignment={item}
                    {...(canRegister && item.status === 'active' && item.blockId !== null
                      ? {
                          onPress: () =>
                            router.push({
                              pathname: '/secretary/organization/role-assignments/substitution',
                              params: { blockId: String(item.blockId) },
                            }),
                        }
                      : {})}
                  />
                ))}
              </MenuGroup>
            </View>
          ) : null}
        </View>
      </ScreenState>
    </ScreenLayout>
  );
}

function AssignmentRow({
  assignment,
  onPress,
}: {
  assignment: RoleAssignment;
  onPress?: () => void;
}) {
  const since = `desde ${formatDate(assignment.startDate)}`;
  const subtitle =
    assignment.status === 'pending'
      ? `${assignment.role === 'block_leader' ? '' : `${assignment.person.fullName} · `}Asignación por confirmar`
      : assignment.role === 'block_leader'
        ? [assignment.contactPhone, since].filter(Boolean).join(' · ')
        : `${assignment.person.fullName} · ${since}`;
  const tag = ASSIGNMENT_TAGS[assignment.status];
  return (
    <ListRow
      title={assignmentTitle(assignment)}
      subtitle={subtitle}
      {...(tag ? { tag } : {})}
      {...(onPress ? { onPress } : {})}
    />
  );
}

const styles = StyleSheet.create({
  groups: { gap: spacing.lg },
  group: { gap: spacing.md },
});
