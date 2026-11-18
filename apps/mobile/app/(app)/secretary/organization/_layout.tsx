import { Stack } from 'expo-router';
import { colors } from '../../../../src/ui/index.js';

// "Organización" tab of the secretary: S-06 and the screens it opens inside the tab (S-07 and
// its two forms, 3.2 §10.7). Those hide the tab bar, as in the Figma captures.

export default function SecretaryOrganizationLayout() {
  return (
    <Stack
      screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}
    />
  );
}
