// A-03 · Detalle de cuenta
import { type AccountSummary, formatDate, formatDateTime } from '@bella-vista/shared';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { describeError } from '../../../../src/api/error-messages.js';
import {
  useAccountAction,
  useManagedAccount,
  useResetPassword,
} from '../../../../src/api/useAccounts.js';
import {
  type AccountCommand,
  accountView,
  COMMAND_TEXTS,
  isManualLock,
} from '../../../../src/features/accounts/account-status.js';
import { ReasonSheet } from '../../../../src/features/accounts/ReasonSheet.js';
import {
  LeavePasswordSheet,
  TemporaryPasswordCard,
} from '../../../../src/features/accounts/TemporaryPasswordCard.js';
import { useLeaveGuard } from '../../../../src/features/accounts/useLeaveGuard.js';
import { roleDescription } from '../../../../src/session/role-labels.js';
import { useAccount } from '../../../../src/session/session-store.js';
import {
  AppText,
  Button,
  colors,
  DataRow,
  Header,
  layout,
  Notice,
  radii,
  ScreenLayout,
  ScreenState,
  screenStatusOf,
  spacing,
} from '../../../../src/ui/index.js';

// Restablecer contraseña, Bloquear, Desbloquear and Desactivar, each confirmed with its reason
// (2.5 §2.9; 3.2 §10.8). Only the actions that fit the real status of the account are offered
// (account-status.ts). A reset shows the new temporary password once, like A-02. The API has no
// "last access", so the card shows the data it does have.

const DONE: Record<Exclude<AccountCommand, 'reset'>, string> = {
  lock: 'La cuenta quedó bloqueada y sus sesiones se cerraron.',
  unlock: 'La cuenta quedó desbloqueada.',
  deactivate: 'La cuenta quedó desactivada.',
};

export default function AccountDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const accountId = Number(id);
  const me = useAccount();
  const query = useManagedAccount(accountId);
  const reset = useResetPassword(accountId);
  const action = useAccountAction(accountId);
  const [command, setCommand] = useState<AccountCommand | null>(null);
  const [password, setPassword] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const guard = useLeaveGuard(password !== null, () => setPassword(null));

  const account = query.data ?? null;
  const status = screenStatusOf(query);

  if (status !== 'ready' || !account) {
    return (
      <ScreenLayout>
        <Header title="Detalle de cuenta" onBack={() => router.back()} />
        {status === 'ready' ? (
          <Notice title="No existe esa cuenta." detail="Vuelva a la lista de cuentas." />
        ) : (
          <ScreenState status={status} error={query.error} onRetry={() => void query.refetch()} />
        )}
      </ScreenLayout>
    );
  }

  const view = accountView(account, account.username === me?.username);
  const pending = command === 'reset' ? reset : action;
  const serverError = pending.isError ? describeError(pending.error).message : null;

  const open = (next: AccountCommand) => {
    reset.reset();
    action.reset();
    setDone(null);
    setCommand(next);
  };

  const confirm = (reason: string) => {
    if (command === 'reset') {
      reset.mutate(
        { reason },
        {
          onSuccess: ({ temporaryPassword }) => {
            setPassword(temporaryPassword);
            // The password now lives only in this screen: drop it from the mutation cache.
            reset.reset();
            setCommand(null);
          },
        },
      );
    } else if (command) {
      const chosen = command;
      action.mutate(
        { action: chosen, reason },
        {
          onSuccess: () => {
            setDone(DONE[chosen]);
            setCommand(null);
          },
        },
      );
    }
  };

  // Main actions in the fixed bar (as in the capture); the rest under the data.
  const [main, ...rest] = view.commands.filter((item) => item !== 'deactivate');
  const second = rest.shift();
  const others = [...rest, ...view.commands.filter((item) => item === 'deactivate')];

  const footer = password ? (
    <Button label="Listo" onPress={() => guard.ask(() => router.back())} />
  ) : main ? (
    <>
      <Button label={COMMAND_TEXTS[main].button} onPress={() => open(main)} />
      {second ? (
        <Button
          label={COMMAND_TEXTS[second].button}
          variant="secondary"
          onPress={() => open(second)}
        />
      ) : null}
    </>
  ) : null;

  return (
    <ScreenLayout {...(footer ? { footer } : {})}>
      <Header
        title={account.username}
        subtitle={`${account.person.fullName} · ${roleDescription(account)}`}
        onBack={() => router.back()}
      />

      {password ? <TemporaryPasswordCard password={password} username={account.username} /> : null}
      {done ? <Notice icon="info" title={done} /> : null}

      <View style={styles.card}>{dataRows(account, view.tag?.label ?? view.summary)}</View>

      {view.notice ? <Notice icon="info" title={view.notice} /> : null}

      {!password
        ? others.map((item) => (
            <Button
              key={item}
              label={COMMAND_TEXTS[item].button}
              variant={item === 'deactivate' ? 'text' : 'secondary'}
              onPress={() => open(item)}
            />
          ))
        : null}

      <AppText variant="caption" color={colors.textSecondary}>
        Toda acción queda en la bitácora técnica.
      </AppText>

      <ReasonSheet
        command={command}
        username={account.username}
        loading={pending.isPending}
        serverError={serverError}
        onConfirm={confirm}
        onCancel={() => setCommand(null)}
      />
      <LeavePasswordSheet
        visible={guard.asking}
        onConfirm={guard.confirm}
        onCancel={guard.cancel}
      />
    </ScreenLayout>
  );
}

function dataRows(account: AccountSummary, statusLabel: string) {
  const rows: [string, string][] = [['Estado', statusLabel]];
  if (account.status === 'locked' && account.lockedUntil && !isManualLock(account)) {
    rows.push(['Bloqueada hasta', formatDateTime(account.lockedUntil)]);
  }
  if (account.deactivatedAt) rows.push(['Desactivada el', formatDateTime(account.deactivatedAt)]);
  rows.push(['Intentos fallidos', String(account.failedAttempts)]);
  rows.push(['Cargo desde', formatDate(account.assignmentStartDate)]);
  if (account.assignmentEndDate) rows.push(['Cargo hasta', formatDate(account.assignmentEndDate)]);
  return rows.map(([label, value]) => <DataRow key={label} label={label} value={value} />);
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    padding: layout.cardPadding,
    gap: spacing.md,
  },
});
