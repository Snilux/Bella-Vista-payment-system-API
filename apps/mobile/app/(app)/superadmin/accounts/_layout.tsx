import { Stack } from 'expo-router';
import { colors } from '../../../../src/ui/index.js';

// "Cuentas" tab of the superadmin: A-01 and the screens it opens inside the tab, A-02 and A-03
// (3.2 §10.8). Those two hide the tab bar, as in the Figma captures.

export default function SuperadminAccountsLayout() {
  return (
    <Stack
      screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}
    />
  );
}
