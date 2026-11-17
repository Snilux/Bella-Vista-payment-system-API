// C-05 · Perfil
import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useLogout } from '../../../src/api/useAuth.js';
import { roleDescription } from '../../../src/session/role-labels.js';
import { useAccount } from '../../../src/session/session-store.js';
import {
  AppText,
  Button,
  ConfirmSheet,
  colors,
  DataRow,
  Header,
  layout,
  MenuGroup,
  MenuRow,
  radii,
  ScreenLayout,
  spacing,
} from '../../../src/ui/index.js';

// Name, user and role, read only (the role is fixed for the account: D-19, D-22). "Cambiar
// contraseña" opens C-02; "Cerrar sesión" asks first, then revokes the session on the API and
// deletes it from the phone.

export default function Profile() {
  const account = useAccount();
  const logout = useLogout();
  const [confirming, setConfirming] = useState(false);

  // The (app) guard only lets in a signed-in account; after "Cerrar sesión" it moves away.
  if (!account) return null;

  return (
    <ScreenLayout>
      <Header title="Perfil" onBack={() => router.back()} />

      <View style={styles.card}>
        <AppText variant="heading">{account.fullName}</AppText>
        <DataRow label="Usuario" value={account.username} />
        <DataRow label="Cargo" value={roleDescription(account)} />
      </View>

      <MenuGroup>
        <MenuRow
          label="Cambiar contraseña"
          icon="key"
          onPress={() => router.push('/new-password')}
        />
      </MenuGroup>

      <Button label="Cerrar sesión" variant="secondary" onPress={() => setConfirming(true)} />

      <AppText variant="caption" color={colors.textSecondary}>
        Su cargo lo asigna el comité y no se puede cambiar aquí.
      </AppText>

      <ConfirmSheet
        visible={confirming}
        title="¿Cerrar sesión?"
        confirmLabel="Sí, cerrar sesión"
        loading={logout.isPending}
        onCancel={() => setConfirming(false)}
        onConfirm={() => logout.mutate()}
      >
        <AppText variant="body">
          Para volver a entrar tendrá que escribir su usuario y contraseña.
        </AppText>
      </ConfirmSheet>
    </ScreenLayout>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surfaceWarm,
    borderRadius: radii.card,
    padding: layout.cardPadding,
    gap: spacing.md,
  },
});
