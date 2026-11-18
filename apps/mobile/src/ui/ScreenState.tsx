import { type ReactNode, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { describeError } from '../api/error-messages.js';
import { isApiError } from '../api/errors.js';
import { AppText } from './AppText.js';
import { Button } from './Button.js';
import { Icon, type IconName } from './Icon.js';
import { colors, iconSizes, layout, spacing } from './theme/index.js';

// Envoltura de estados (3.2 §11.1, 2.4 §6.7): loading, empty, error with "Reintentar", no
// connection and no permission look the same on every screen.

/** After this long still loading, the screen says the signal is weak (each try waits up to 15 s). */
export const SLOW_LOADING_MS = 8_000;
export const SLOW_LOADING_MESSAGE =
  'La señal es débil; seguimos intentando. Si no carga, regrese e intente más tarde.';

export type ScreenStatus = 'loading' | 'empty' | 'error' | 'offline' | 'forbidden' | 'ready';

export type EmptyState = {
  /** A sentence and, when there is one, the suggested action ("No hay entregas por confirmar."). */
  message: string;
  icon?: IconName;
  action?: { label: string; onPress: () => void };
};

/** The fields of a TanStack Query result this needs. */
export type QueryLike<T> = {
  status: 'pending' | 'error' | 'success';
  fetchStatus: 'fetching' | 'paused' | 'idle';
  error: unknown;
  data: T | undefined;
};

/** Query → screen status. Data already on screen stays visible while it reloads. */
export function screenStatusOf<T>(
  query: QueryLike<T>,
  isEmpty?: (data: T) => boolean,
): ScreenStatus {
  if (query.status === 'pending') return query.fetchStatus === 'paused' ? 'offline' : 'loading';
  if (query.status === 'error') {
    if (isApiError(query.error)) {
      if (query.error.code === 'FORBIDDEN' || query.error.code === 'OUT_OF_SCOPE')
        return 'forbidden';
      if (query.error.code === 'NETWORK_ERROR') return 'offline';
    }
    return 'error';
  }
  return query.data !== undefined && isEmpty?.(query.data) ? 'empty' : 'ready';
}

export type ScreenStateProps = {
  status: ScreenStatus;
  error?: unknown;
  onRetry?: () => void;
  empty?: EmptyState;
  children?: ReactNode;
};

export function ScreenState({ status, error, onRetry, empty, children }: ScreenStateProps) {
  switch (status) {
    case 'ready':
      return <>{children}</>;
    case 'loading':
      return <Loading />;
    case 'empty':
      return (
        <Centered>
          <Icon name={empty?.icon ?? 'info'} size={iconSizes.empty} />
          <AppText variant="body" style={styles.text}>
            {empty?.message ?? 'No hay nada que mostrar.'}
          </AppText>
          {empty?.action ? (
            <Button label={empty.action.label} variant="secondary" onPress={empty.action.onPress} />
          ) : null}
        </Centered>
      );
    case 'offline':
      return (
        <Centered>
          <Icon name="offline" size={iconSizes.empty} />
          <AppText variant="body" style={styles.text}>
            No hay conexión. Revise su señal e intente de nuevo.
          </AppText>
          {onRetry ? <Button label="Reintentar" variant="secondary" onPress={onRetry} /> : null}
        </Centered>
      );
    case 'forbidden':
      // Never reveals data: only the sentence.
      return (
        <Centered>
          <Icon name="lock" size={iconSizes.empty} />
          <AppText variant="body" style={styles.text}>
            No tiene permiso para esta acción.
          </AppText>
        </Centered>
      );
    case 'error': {
      const described = describeError(error);
      return (
        <Centered>
          <Icon name="alert" size={iconSizes.empty} color={colors.error} />
          <AppText variant="body" style={styles.text}>
            {described.message}
          </AppText>
          {onRetry && described.action !== 'login' ? (
            <Button label="Reintentar" variant="secondary" onPress={onRetry} />
          ) : null}
        </Centered>
      );
    }
  }
}

/** Spinner; after SLOW_LOADING_MS also the weak-signal sentence (M9: up to ~48 s with retries). */
function Loading() {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), SLOW_LOADING_MS);
    return () => clearTimeout(timer);
  }, []);
  return (
    <Centered>
      <ActivityIndicator size="large" color={colors.primaryStrong} />
      <AppText variant="body" color={colors.textSecondary} style={styles.text}>
        {slow ? SLOW_LOADING_MESSAGE : 'Cargando...'}
      </AppText>
    </Centered>
  );
}

function Centered({ children }: { children: ReactNode }) {
  return (
    <View style={styles.centered} accessibilityLiveRegion="polite">
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  centered: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.lg,
    paddingHorizontal: layout.screenMargin,
    paddingVertical: spacing.xxxl,
  },
  text: { textAlign: 'center' },
});
