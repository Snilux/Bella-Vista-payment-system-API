import { QueryClientProvider } from '@tanstack/react-query';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { initialWindowMetrics, SafeAreaProvider } from 'react-native-safe-area-context';
import { connectNetworkToQueries } from '../src/api/network.js';
import { createQueryClient } from '../src/api/query-client.js';
import { restoreSession } from '../src/api/useAuth.js';
import { sessionStore } from '../src/session/session-store.js';
import { colors, fontAssets } from '../src/ui/theme/index.js';

connectNetworkToQueries();

/**
 * Root layout: Inter, TanStack Query and the safe area. On opening it restores the stored
 * session (3.2 §3.2); whenever the session ends it forgets every cached answer, so the next
 * account never sees data of the previous one.
 */
export default function RootLayout() {
  const [queryClient] = useState(createQueryClient);
  const [fontsLoaded, fontError] = useFonts(fontAssets);

  useEffect(() => {
    void restoreSession();
  }, []);

  useEffect(
    () =>
      sessionStore.subscribe(() => {
        if (sessionStore.get().status === 'signed-out') queryClient.clear();
      }),
    [queryClient],
  );

  // Until Inter loads the text would jump fonts; a font error still lets the app run.
  if (!fontsLoaded && !fontError) return null;

  return (
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <QueryClientProvider client={queryClient}>
        <StatusBar style="dark" />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: colors.background },
          }}
        />
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
