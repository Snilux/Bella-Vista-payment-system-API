import { useIsOnline } from '../api/network.js';
import { Notice } from './Notice.js';

/** "Sin conexión" page notice (M1): shown at the top while the phone has no network. */
export function OfflineNotice() {
  const online = useIsOnline();
  if (online) return null;
  return (
    <Notice
      icon="offline"
      title="Sin conexión"
      detail="Revise su señal. Lo que vea puede no estar al día; al volver la conexión se actualiza."
    />
  );
}
