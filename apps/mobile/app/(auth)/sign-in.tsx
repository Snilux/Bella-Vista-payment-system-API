// C-01 · Iniciar sesión
import { loginRequestSchema } from '@bella-vista/shared';
import { Redirect, router } from 'expo-router';
import { useRef, useState } from 'react';
import { StyleSheet, type TextInputInstance, View } from 'react-native';
import { getApiClient } from '../../src/api/api.js';
import { describeError, sessionEndMessage } from '../../src/api/error-messages.js';
import { useLogin } from '../../src/api/useAuth.js';
import { useSession } from '../../src/session/session-store.js';
import {
  AppText,
  Button,
  colors,
  Header,
  Icon,
  iconSizes,
  Notice,
  radii,
  ScreenLayout,
  spacing,
  TextField,
} from '../../src/ui/index.js';

// Usuario y contraseña (2.5 §2.1, CU-01). There is no sign-up: the administrator hands out the
// account. A wrong user and a wrong password get the same message, so the screen never reveals
// whether a user exists. Locked, disabled and closed-role accounts get their own message. When
// the app closed the session by itself (expired, role no longer current…) it says why on top.

type Fields = { username?: string; password?: string };

export default function SignIn() {
  const session = useSession();
  const login = useLogin();
  const passwordRef = useRef<TextInputInstance>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Fields>({});

  if (session.status === 'signed-in') return <Redirect href="/" />;

  const configured = getApiClient() !== null;
  const ended = session.status === 'signed-out' ? session.ended : null;

  const submit = () => {
    const parsed = loginRequestSchema.safeParse({ username, password });
    if (!parsed.success) {
      const errors: Fields = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path[0];
        if (field === 'username' || field === 'password') errors[field] ??= issue.message;
      }
      setFieldErrors(errors);
      return;
    }
    setFieldErrors({});
    // On success the account reaches the session state and the guard opens the role's home.
    login.mutate(parsed.data, { onSuccess: () => setPassword('') });
  };

  return (
    <ScreenLayout
      footer={
        <>
          <Button
            label="Entrar"
            onPress={submit}
            loading={login.isPending}
            loadingLabel="Entrando..."
            disabledReason={configured ? null : 'Falta la dirección del servidor.'}
          />
          <AppText variant="caption" color={colors.textSecondary} style={styles.centered}>
            El administrador le entrega su usuario y contraseña. Si olvidó su contraseña, pídasela a
            él.
          </AppText>
          {__DEV__ ? (
            <Button
              label="Galería de componentes (desarrollo)"
              variant="text"
              onPress={() => router.push('/dev/gallery')}
            />
          ) : null}
        </>
      }
    >
      <View style={styles.brand}>
        <View style={styles.logo}>
          <Icon name="connection" size={iconSizes.empty} color={colors.primary} />
        </View>
        <AppText variant="label" color={colors.textSecondary} style={styles.centered}>
          Comité de Agua Bella Vista
        </AppText>
      </View>
      <Header title="Iniciar sesión" subtitle="Escriba sus datos para entrar." />

      {ended ? <Notice title={sessionEndMessage(ended)} /> : null}
      {configured ? null : (
        <Notice
          title="Falta la dirección del servidor"
          detail="Defina EXPO_PUBLIC_API_URL (sin /v1) y vuelva a iniciar Expo."
        />
      )}

      <TextField
        label="Usuario"
        required
        value={username}
        onChangeText={setUsername}
        error={fieldErrors.username ?? null}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="username"
        textContentType="username"
        returnKeyType="next"
        onSubmitEditing={() => passwordRef.current?.focus()}
        submitBehavior="submit"
      />
      <TextField
        ref={passwordRef}
        label="Contraseña"
        required
        password
        value={password}
        onChangeText={setPassword}
        error={fieldErrors.password ?? null}
        help="Toque el campo y escriba con calma."
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="current-password"
        textContentType="password"
        returnKeyType="go"
        onSubmitEditing={submit}
      />

      {login.isError ? <Notice title={describeError(login.error).message} /> : null}
    </ScreenLayout>
  );
}

const styles = StyleSheet.create({
  brand: { alignItems: 'center', gap: spacing.md, paddingBottom: spacing.lg },
  logo: {
    backgroundColor: colors.surfaceWarm,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xl,
  },
  centered: { textAlign: 'center' },
});
