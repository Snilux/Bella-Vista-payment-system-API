import { Stack } from 'expo-router';
import { colors } from '../../../../src/ui/index.js';

// "Entregas" tab of the treasurer: T-02 and T-03 inside the tab.

export default function TreasurerHandoversLayout() {
  return (
    <Stack
      screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}
    />
  );
}
