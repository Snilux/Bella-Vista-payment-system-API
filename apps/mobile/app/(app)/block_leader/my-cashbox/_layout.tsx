import { Stack } from 'expo-router';
import { colors } from '../../../../src/ui/index.js';

// "Mi caja" tab of the block leader: J-02 and the screens it opens inside the tab (J-03, J-04).

export default function BlockLeaderCashboxLayout() {
  return (
    <Stack
      screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}
    />
  );
}
