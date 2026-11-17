import { Stack } from 'expo-router';
import { colors } from '../../src/ui/index.js';

// Session group (2.5 §3.1): C-01 and C-02. C-02 cannot be left with the back gesture; while the
// password is temporary its screen also blocks the Android back button.

export default function AuthLayout() {
  return (
    <Stack
      screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}
    >
      <Stack.Screen name="sign-in" />
      <Stack.Screen name="new-password" options={{ gestureEnabled: false }} />
    </Stack>
  );
}
