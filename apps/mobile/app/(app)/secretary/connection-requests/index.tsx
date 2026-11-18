// S-02 · Solicitudes de toma
import { ConnectionRequestList } from '../../../../src/features/registry/ConnectionRequestList.js';

// Every request by status, one chip per status of the API, "Por resolver" when it opens
// (approved difference with Figma, 3.2 §6 M5). A request to resolve opens S-03.

export default function SecretaryConnectionRequests() {
  return <ConnectionRequestList title="Solicitudes de toma" withFilters withinTabs />;
}
