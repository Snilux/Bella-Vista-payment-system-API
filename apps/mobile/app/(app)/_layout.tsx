import { Redirect, Stack } from 'expo-router';
import { useSession } from '../../src/session/session-store.js';
import { colors } from '../../src/ui/index.js';

// Everything after signing in. Without a session, or with a temporary password, nothing here
// opens: the start screen sends the person to C-01 or C-02. The role folders hold the tabs of
// each role; common/ holds the shared screens, which open over the tabs.

export default function AppLayout() {
  const session = useSession();
  if (session.status !== 'signed-in' || session.account.mustChangePassword) {
    return <Redirect href="/" />;
  }
  return (
    <Stack
      screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}
    />
  );
}
