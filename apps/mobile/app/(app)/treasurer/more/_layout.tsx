import { Stack } from 'expo-router';
import { colors } from '../../../../src/ui/index.js';

// "Más" tab of the treasurer role: C-04 and, in later phases, the screens it opens inside the tab.

export default function TreasurerMoreLayout() {
  return (
    <Stack
      screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}
    />
  );
}
