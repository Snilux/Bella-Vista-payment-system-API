import { QueryClientProvider } from '@tanstack/react-query';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { connectNetworkToQueries } from '../src/api/network.js';
import { createQueryClient } from '../src/api/query-client.js';
import { colors, fontAssets } from '../src/ui/theme/index.js';

connectNetworkToQueries();

/** Root layout: Inter, TanStack Query and the safe area. M2 adds the session and role groups. */
export default function RootLayout() {
  const [queryClient] = useState(createQueryClient);
  const [fontsLoaded, fontError] = useFonts(fontAssets);

  // Until Inter loads the text would jump fonts; a font error still lets the app run.
  if (!fontsLoaded && !fontError) return null;

  return (
    <SafeAreaProvider>
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
