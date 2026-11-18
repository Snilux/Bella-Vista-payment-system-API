import { Stack } from 'expo-router';
import { colors } from '../../../../src/ui/index.js';

// "Tomas" tab of the secretary: S-02 and the screen it opens inside the tab (S-03,
// 3.2 §10.7), which hides the tab bar, as in the Figma captures.

export default function SecretaryConnectionRequestsLayout() {
  return (
    <Stack
      screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}
    />
  );
}
