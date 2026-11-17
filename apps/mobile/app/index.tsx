import { router } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getApiClient } from '../src/api/api.js';
import { describeError } from '../src/api/error-messages.js';
import { useHealth } from '../src/api/useHealth.js';
import {
  AppText,
  Button,
  colors,
  Header,
  layout,
  Notice,
  OfflineNotice,
  StatusTag,
  spacing,
} from '../src/ui/index.js';

// Temporary start screen of M1: shows that the app reaches the API (/health) and, in
// development, opens the component gallery. M2 replaces it with the redirect to C-01 or to
// the role's home.

export default function StartScreen() {
  const configured = getApiClient() !== null;
  const health = useHealth();

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content}>
        <OfflineNotice />
        <Header title="Comité de Agua Bella Vista" subtitle="Versión en construcción" />
        <View style={styles.status}>
          <AppText variant="label">Conexión con el servidor</AppText>
          {!configured ? (
            <Notice
              title="Falta la dirección del servidor"
              detail="Defina EXPO_PUBLIC_API_URL (sin /v1) y vuelva a iniciar Expo."
            />
          ) : health.isSuccess ? (
            <StatusTag tone="paid" label="Conectado" />
          ) : health.isPending ? (
            <StatusTag tone="pending" label="Comprobando..." />
          ) : (
            <>
              <StatusTag tone="overdue" label="Sin respuesta" />
              <AppText variant="caption" color={colors.textSecondary}>
                {describeError(health.error).message}
              </AppText>
            </>
          )}
        </View>
        {configured ? (
          <Button
            label="Comprobar de nuevo"
            variant="secondary"
            onPress={() => void health.refetch()}
            loading={health.isFetching}
            loadingLabel="Comprobando..."
          />
        ) : null}
        {__DEV__ ? (
          <Button label="Ver galería de componentes" onPress={() => router.push('/dev/gallery')} />
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: { padding: layout.screenMargin, gap: spacing.xl },
  status: { gap: spacing.sm },
});
