// C-02 · Nueva contraseña
import { changePasswordRequestSchema, PASSWORD_MIN_LENGTH } from '@bella-vista/shared';
import { Redirect, router, useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { BackHandler, StyleSheet, type TextInputInstance } from 'react-native';
import { fieldErrors as apiFieldErrors, describeError } from '../../src/api/error-messages.js';
import { isApiError } from '../../src/api/errors.js';
import { useChangePassword } from '../../src/api/useAuth.js';
import { useAccount } from '../../src/session/session-store.js';
import {
  AppText,
  Button,
  colors,
  Header,
  Notice,
  ScreenLayout,
  SuccessScreen,
  TextField,
} from '../../src/ui/index.js';

// Two uses of the same screen (2.5 §3.1; 3.2 §10.1):
// - forced: the account has a temporary password (mustChangePassword). Nothing else in the app
//   opens until it changes (the API also refuses with PASSWORD_CHANGE_REQUIRED): no back button,
//   no back gesture, and the Android back button does nothing. Saving enters the role's home.
// - from C-05 "Cambiar contraseña": back is allowed and saving shows a success page.
// The rules are on screen before typing (at least 8 characters, different from the current one).

type Fields = { currentPassword?: string; newPassword?: string; confirmation?: string };

export default function NewPassword() {
  const account = useAccount();
  const change = useChangePassword();
  const newRef = useRef<TextInputInstance>(null);
  const confirmRef = useRef<TextInputInstance>(null);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [errors, setErrors] = useState<Fields>({});
  const [changed, setChanged] = useState(false);
  // Decided when the screen opens: saving turns mustChangePassword off but keeps the mode.
  const [forced] = useState(account?.mustChangePassword ?? false);

  useFocusEffect(
    useCallback(() => {
      if (!forced) return undefined;
      const subscription = BackHandler.addEventListener('hardwareBackPress', () => true);
      return () => subscription.remove();
    }, [forced]),
  );

  if (!account) return <Redirect href="/" />;

  if (changed) {
    return (
      <SuccessScreen
        title="Contraseña cambiada"
        message="Use la nueva contraseña la próxima vez que entre. Las sesiones en otros teléfonos se cerraron."
        onDone={() => router.back()}
      />
    );
  }

  const submit = () => {
    const found: Fields = {};
    const parsed = changePasswordRequestSchema.safeParse({ currentPassword, newPassword });
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const field = issue.path[0];
        if (field === 'currentPassword' || field === 'newPassword') found[field] ??= issue.message;
      }
    }
    if (!found.newPassword && confirmation !== newPassword) {
      found.confirmation = 'Las contraseñas no coinciden. Escríbala igual en los dos campos.';
    }
    setErrors(found);
    if (!parsed.success || found.confirmation) return;

    change.mutate(parsed.data, {
      onSuccess: () => {
        if (forced) router.replace('/');
        else setChanged(true);
      },
      onError: (error) => {
        if (isApiError(error) && error.code === 'INVALID_CREDENTIALS') {
          setErrors({ currentPassword: error.message || 'La contraseña actual no es correcta.' });
        } else {
          setErrors(apiFieldErrors(error));
        }
      },
    });
  };

  const serverError =
    change.isError &&
    !(
      isApiError(change.error) &&
      ['INVALID_CREDENTIALS', 'VALIDATION_ERROR'].includes(change.error.code)
    )
      ? describeError(change.error).message
      : null;

  return (
    <ScreenLayout
      footer={
        <>
          <Button
            label="Guardar contraseña"
            onPress={submit}
            loading={change.isPending}
            loadingLabel="Guardando..."
          />
          {forced ? (
            <AppText variant="caption" color={colors.textSecondary} style={styles.centered}>
              No podrá usar la aplicación hasta cambiar la contraseña temporal.
            </AppText>
          ) : null}
        </>
      }
    >
      {forced ? (
        <Header
          title="Nueva contraseña"
          subtitle="Por seguridad, cambie la contraseña temporal que le entregó el administrador."
        />
      ) : (
        <Header
          title="Cambiar contraseña"
          subtitle="Escriba su contraseña actual y la nueva."
          onBack={() => router.back()}
        />
      )}

      <TextField
        label="Contraseña actual"
        required
        password
        value={currentPassword}
        onChangeText={setCurrentPassword}
        error={errors.currentPassword ?? null}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="current-password"
        textContentType="password"
        returnKeyType="next"
        onSubmitEditing={() => newRef.current?.focus()}
        submitBehavior="submit"
      />
      <TextField
        ref={newRef}
        label="Nueva contraseña"
        required
        password
        value={newPassword}
        onChangeText={setNewPassword}
        error={errors.newPassword ?? null}
        help={`Al menos ${PASSWORD_MIN_LENGTH} caracteres y distinta de la actual. Use una contraseña que solo usted conozca.`}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="new-password"
        textContentType="newPassword"
        returnKeyType="next"
        onSubmitEditing={() => confirmRef.current?.focus()}
        submitBehavior="submit"
      />
      <TextField
        ref={confirmRef}
        label="Repita la nueva contraseña"
        required
        password
        value={confirmation}
        onChangeText={setConfirmation}
        error={errors.confirmation ?? null}
        help="Escríbala otra vez para confirmarla."
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="new-password"
        textContentType="newPassword"
        returnKeyType="go"
        onSubmitEditing={submit}
      />

      {serverError ? <Notice title={serverError} /> : null}
    </ScreenLayout>
  );
}

const styles = StyleSheet.create({
  centered: { textAlign: 'center' },
});
