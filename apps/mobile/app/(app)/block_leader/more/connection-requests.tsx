// J-06 · Mis solicitudes de toma
import { router } from 'expo-router';
import { ConnectionRequestList } from '../../../../src/features/registry/ConnectionRequestList.js';
import { useAccount } from '../../../../src/session/session-store.js';

// The requests of the leader's block, newest first, with "Nueva solicitud" (P-05). A request
// opens its page (P-06), where a pending one can be cancelled with a reason (D-12) or, with the
// opening paid, installed.

export default function MyConnectionRequests() {
  const account = useAccount();
  return (
    <ConnectionRequestList
      title="Solicitudes de toma"
      {...(account?.blockCode ? { subtitle: `Manzana ${account.blockCode}` } : {})}
      withFilters={false}
      onBack={() => router.back()}
    />
  );
}
