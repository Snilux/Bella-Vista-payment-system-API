import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { ComingSoon } from '../../../src/features/session/ComingSoon.js';
import { isScreenId } from '../../../src/session/screen-catalog.js';

// "Próximamente" for a "Más" option whose screen a later phase builds (role-menu.ts sends it
// here with ?screen=<ID>). Not a screen of the catalog: it disappears once every screen exists.

export default function ComingSoonPage() {
  const { screen } = useLocalSearchParams<{ screen?: string }>();
  if (!screen || !isScreenId(screen)) return <Redirect href="/" />;
  return <ComingSoon screen={screen} onBack={() => router.back()} />;
}
