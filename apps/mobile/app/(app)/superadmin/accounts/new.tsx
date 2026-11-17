// A-02 · Crear cuenta
import { createAccountRequestSchema } from '@bella-vista/shared';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { describeError, fieldErrors } from '../../../../src/api/error-messages.js';
import { isApiError } from '../../../../src/api/errors.js';
import { useAccountList, useCreateAccount } from '../../../../src/api/useAccounts.js';
import { suggestUsername } from '../../../../src/features/accounts/suggest-username.js';
import {
  LeavePasswordSheet,
  TemporaryPasswordCard,
} from '../../../../src/features/accounts/TemporaryPasswordCard.js';
import { useLeaveGuard } from '../../../../src/features/accounts/useLeaveGuard.js';
import { roleDescription } from '../../../../src/session/role-labels.js';
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
  Select,
  screenStatusOf,
  spacing,
  TextField,
} from '../../../../src/ui/index.js';

// Only the superadmin creates accounts, one per current assignment; the role and block come
// from the assignment and stay fixed (2.5 §2.9; 3.2 §10.8; D-19, D-22). The answer carries the
// temporary password: it is shown once (TemporaryPasswordCard), lives only in this screen's
// state, never in the query or mutation cache, and leaving asks first (useLeaveGuard).

type Fields = { roleAssignmentId?: string; username?: string };
type Created = { username: string; fullName: string; role: string; password: string };

export default function CreateAccount() {
  const params = useLocalSearchParams<{ roleAssignmentId?: string }>();
  const query = useAccountList();
  const create = useCreateAccount();
  const [assignmentId, setAssignmentId] = useState<number | null>(
    params.roleAssignmentId ? Number(params.roleAssignmentId) : null,
  );
  const [username, setUsername] = useState('');
  const [usernameEdited, setUsernameEdited] = useState(false);
  const [errors, setErrors] = useState<Fields>({});
  const [created, setCreated] = useState<Created | null>(null);
  const guard = useLeaveGuard(created !== null, () => setCreated(null));

  const assignments = query.data?.assignmentsWithoutAccount ?? [];
  const chosen = assignments.find((item) => item.roleAssignmentId === assignmentId) ?? null;
  const options = useMemo(
    () =>
      assignments.map((item) => ({
        value: item.roleAssignmentId,
        label: `${item.person.fullName} · ${roleDescription(item)}`,
      })),
    [assignments],
  );

  // Propose "nombre.apellido" for the chosen person until the superadmin types their own.
  useEffect(() => {
    if (chosen && !usernameEdited) setUsername(suggestUsername(chosen.person.fullName) ?? '');
  }, [chosen, usernameEdited]);

  if (created) {
    return (
      <ScreenLayout
        footer={<Button label="Listo" onPress={() => guard.ask(() => router.back())} />}
      >
        <Header title="Cuenta creada" onBack={() => router.back()} />
        <View style={styles.card}>
          <AppText variant="heading">{created.fullName}</AppText>
          <DataRow label="Usuario" value={created.username} />
          <DataRow label="Cargo" value={created.role} />
        </View>
        <TemporaryPasswordCard password={created.password} username={created.username} />
        <LeavePasswordSheet
          visible={guard.asking}
          onConfirm={guard.confirm}
          onCancel={guard.cancel}
        />
      </ScreenLayout>
    );
  }

  const submit = () => {
    const found: Fields = {};
    if (!chosen) found.roleAssignmentId = 'Elija la asignación de cargo.';
    const parsed = createAccountRequestSchema.safeParse({
      roleAssignmentId: assignmentId ?? undefined,
      username,
    });
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const field = issue.path[0];
        if (field === 'username' || field === 'roleAssignmentId') found[field] ??= issue.message;
      }
    }
    setErrors(found);
    if (!parsed.success || !chosen) return;

    create.mutate(parsed.data, {
      onSuccess: ({ account, temporaryPassword }) => {
        setCreated({
          username: account.username,
          fullName: account.person.fullName,
          role: roleDescription(account),
          password: temporaryPassword,
        });
        // The password now lives only in this screen: drop it from the mutation cache.
        create.reset();
      },
      onError: (error) => {
        if (!isApiError(error)) return;
        if (error.code === 'USERNAME_TAKEN') {
          setErrors({ username: describeError(error).message });
        } else if (
          error.code === 'ASSIGNMENT_HAS_ACCOUNT' ||
          error.code === 'ASSIGNMENT_NOT_ACTIVE'
        ) {
          setErrors({ roleAssignmentId: describeError(error).message });
          setAssignmentId(null);
          void query.refetch();
        } else {
          setErrors(fieldErrors(error));
        }
      },
    });
  };

  const handled = [
    'USERNAME_TAKEN',
    'ASSIGNMENT_HAS_ACCOUNT',
    'ASSIGNMENT_NOT_ACTIVE',
    'VALIDATION_ERROR',
  ];
  const serverError =
    create.isError && !(isApiError(create.error) && handled.includes(create.error.code))
      ? describeError(create.error).message
      : null;
  const status = screenStatusOf(query, (data) => data.assignmentsWithoutAccount.length === 0);

  return (
    <ScreenLayout
      {...(status === 'ready'
        ? {
            footer: (
              <Button
                label="Crear cuenta"
                onPress={submit}
                loading={create.isPending}
                loadingLabel="Creando..."
              />
            ),
          }
        : {})}
    >
      <Header
        title="Crear cuenta"
        subtitle="Solo el administrador crea cuentas"
        onBack={() => router.back()}
      />
      <ScreenState
        status={status}
        error={query.error}
        onRetry={() => void query.refetch()}
        empty={{
          message:
            'No hay cargos vigentes sin cuenta. Cuando el comité confirme un cargo, aparecerá aquí.',
          icon: 'accounts',
        }}
      >
        <Select
          label="Asignación vigente sin cuenta"
          required
          options={options}
          value={assignmentId}
          onChange={(value) => {
            setAssignmentId(value);
            setErrors(({ username: usernameError }) =>
              usernameError ? { username: usernameError } : {},
            );
          }}
          placeholder="Elija la persona y su cargo"
          help="El cargo y la manzana vienen de la asignación y quedan fijos en la cuenta. Si la persona tiene otro cargo, se crea otra cuenta."
          error={errors.roleAssignmentId ?? null}
        />
        <TextField
          label="Usuario"
          required
          value={username}
          onChangeText={(text) => {
            setUsername(text);
            setUsernameEdited(true);
          }}
          help="Minúsculas, sin espacios. Puede usar punto, guion y guion bajo."
          error={errors.username ?? null}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="off"
          returnKeyType="done"
          onSubmitEditing={submit}
        />
        <AppText variant="caption" color={colors.textSecondary}>
          Al crearla verá la contraseña temporal una sola vez.
        </AppText>
        {serverError ? <Notice title={serverError} /> : null}
      </ScreenState>
    </ScreenLayout>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    padding: layout.cardPadding,
    gap: spacing.md,
  },
});
