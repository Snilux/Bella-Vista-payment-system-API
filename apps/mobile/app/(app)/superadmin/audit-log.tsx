// A-04 · Bitácora técnica
import type { AuditEntry } from '@bella-vista/shared';
import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { queryKeys } from '../../../src/api/keys.js';
import { useAccountList } from '../../../src/api/useAccounts.js';
import { useAuditLogPages } from '../../../src/api/useAuditLog.js';
import { auditEntryView } from '../../../src/features/accounts/audit-labels.js';
import {
  AppText,
  borders,
  colors,
  Header,
  ListRow,
  OfflineNotice,
  PaginatedList,
  spacing,
} from '../../../src/ui/index.js';

// The technical actions, newest first, 20 at a time (2.5 §2.9; 3.2 §10.8; Figma A-04). The API
// only gives the superadmin the technical entries (accounts, passwords, locks). Each row names
// the account it touched with the account list.

export default function TechnicalAuditLog() {
  const fetchPage = useAuditLogPages();
  const accounts = useAccountList();
  const usernames = useMemo(
    () => new Map((accounts.data?.accounts ?? []).map((item) => [item.id, item.username])),
    [accounts.data],
  );

  const renderItem = (entry: AuditEntry) => {
    const view = auditEntryView(entry, usernames);
    return (
      <View style={styles.row}>
        <ListRow title={view.title} subtitle={view.subtitle} />
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <PaginatedList
        queryKey={queryKeys.auditLog}
        fetchPage={fetchPage}
        keyExtractor={(entry) => String(entry.id)}
        renderItem={renderItem}
        empty={{ message: 'Todavía no hay acciones técnicas registradas.', icon: 'auditLog' }}
        header={
          <View style={styles.header}>
            <OfflineNotice />
            <Header title="Bitácora técnica" />
            <AppText variant="caption" color={colors.textSecondary}>
              El soporte técnico no puede registrar cobros, gastos ni autorizaciones.
            </AppText>
          </View>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: { paddingTop: spacing.xxl, paddingBottom: spacing.md, gap: spacing.md },
  row: {
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.lg,
    borderLeftWidth: borders.hairline,
    borderRightWidth: borders.hairline,
    borderColor: colors.divider,
  },
});
