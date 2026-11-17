// A-01 · Cuentas
import { formatDate } from '@bella-vista/shared';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useAccountList } from '../../../../src/api/useAccounts.js';
import { filterAccountList } from '../../../../src/features/accounts/account-list.js';
import { accountView } from '../../../../src/features/accounts/account-status.js';
import { roleDescription } from '../../../../src/session/role-labels.js';
import { useAccount } from '../../../../src/session/session-store.js';
import {
  AppText,
  colors,
  Header,
  RecordCard,
  ScreenLayout,
  ScreenState,
  SearchField,
  screenStatusOf,
  spacing,
} from '../../../../src/ui/index.js';

// The superadmin's inbox and the accounts (2.5 §2.9; 3.2 §10.8; Figma A-01): first the current
// assignments that still have no account ("Crear cuenta" opens A-02 with it chosen), then every
// account with its status in words. Only the superadmin creates accounts (D-19, D-22).

export default function Accounts() {
  const me = useAccount();
  const query = useAccountList();
  const [search, setSearch] = useState('');
  const list = useMemo(
    () => (query.data ? filterAccountList(query.data, search) : null),
    [query.data, search],
  );
  const status = screenStatusOf(
    query,
    (data) => data.accounts.length === 0 && data.assignmentsWithoutAccount.length === 0,
  );
  const nothingFound =
    list !== null && list.accounts.length === 0 && list.assignmentsWithoutAccount.length === 0;

  return (
    <ScreenLayout withinTabs>
      <Header title="Cuentas" subtitle="Soporte técnico" />
      <SearchField value={search} onChangeText={setSearch} placeholder="Buscar usuario" />

      <ScreenState
        status={status}
        error={query.error}
        onRetry={() => void query.refetch()}
        empty={{ message: 'Todavía no hay cuentas ni cargos por atender.', icon: 'accounts' }}
      >
        <View style={styles.list}>
          {list?.assignmentsWithoutAccount.map((assignment) => (
            <RecordCard
              key={`assignment-${assignment.roleAssignmentId}`}
              title={`${assignment.person.fullName} · sin cuenta`}
              details={[
                `${roleDescription(assignment)} · desde ${formatDate(assignment.startDate)}`,
              ]}
              summary="Crear cuenta"
              tag={{ tone: 'pending', label: 'Sin cuenta' }}
              accessibilityHint="Abre Crear cuenta con este cargo"
              onPress={() =>
                router.push({
                  pathname: '/superadmin/accounts/new',
                  params: { roleAssignmentId: String(assignment.roleAssignmentId) },
                })
              }
            />
          ))}

          {list?.accounts.map((account) => {
            const view = accountView(account, account.username === me?.username);
            return (
              <RecordCard
                key={`account-${account.id}`}
                title={account.username}
                details={[`${account.person.fullName} · ${roleDescription(account)}`]}
                summary={view.summary}
                {...(view.tag ? { tag: view.tag } : {})}
                accessibilityHint="Abre el detalle de la cuenta"
                onPress={() => router.push(`/superadmin/accounts/${account.id}`)}
              />
            );
          })}

          {nothingFound ? (
            <AppText variant="body" color={colors.textSecondary}>
              {`Ningún usuario coincide con «${search.trim()}».`}
            </AppText>
          ) : null}
        </View>
      </ScreenState>
    </ScreenLayout>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.md },
});
