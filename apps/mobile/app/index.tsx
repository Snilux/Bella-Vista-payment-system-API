import { Redirect } from 'expo-router';
import { isNetworkError } from '../src/api/errors.js';
import { restoreSession } from '../src/api/useAuth.js';
import { homeHref } from '../src/session/role-menu.js';
import { useSession } from '../src/session/session-store.js';
import { Header, ScreenLayout, ScreenState } from '../src/ui/index.js';

// Start of the app: decides where the person goes from the session (3.2 §3.2, 2.5 §3.1).
// Restoring → wait; no session → C-01; temporary password → C-02; otherwise the home of the
// role. If the stored session could not be checked (no connection), it offers to retry
// instead of asking for the password again.

export default function Start() {
  const session = useSession();

  switch (session.status) {
    case 'signed-out':
      return <Redirect href="/sign-in" />;
    case 'signed-in':
      return (
        <Redirect
          href={
            session.account.mustChangePassword ? '/new-password' : homeHref(session.account.role)
          }
        />
      );
    case 'restoring':
      return (
        <ScreenLayout>
          <ScreenState status="loading" />
        </ScreenLayout>
      );
    case 'unreachable':
      return (
        <ScreenLayout>
          <Header title="Comité de Agua Bella Vista" />
          <ScreenState
            status={isNetworkError(session.error) ? 'offline' : 'error'}
            error={session.error}
            onRetry={() => void restoreSession()}
          />
        </ScreenLayout>
      );
  }
}
