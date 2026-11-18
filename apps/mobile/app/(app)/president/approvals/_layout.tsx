import { Stack } from 'expo-router';
import { colors } from '../../../../src/ui/index.js';

// "Autorizaciones" tab of the president: R-02 and the screens it opens inside the tab (the
// list of one type and R-03, 3.2 §10.8). Those hide the tab bar, as in the Figma captures.

export default function PresidentApprovalsLayout() {
  return (
    <Stack
      screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}
    />
  );
}
