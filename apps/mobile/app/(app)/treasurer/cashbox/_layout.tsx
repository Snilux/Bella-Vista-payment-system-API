import { Stack } from 'expo-router';
import { colors } from '../../../../src/ui/index.js';

// "Caja" tab of the treasurer: T-04 and the screens it opens (T-05 to T-07) inside the tab.

export default function TreasurerCashboxLayout() {
  return (
    <Stack
      screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}
    />
  );
}
