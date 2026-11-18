// J-03 · Preparar entrega
import { PrepareHandoverScreen } from '../../../../src/features/cashboxes/CashboxScreens.js';

// Prepare a handover for the treasurer (Figma J-03; 2.6; D-16): never more than what the leader
// may still hand over, with the reason next to the field. It goes through useMoneyOperation with
// its Idempotency-Key; the amount stays in the cashbox until the treasurer confirms it.

export default function BlockLeaderNewHandover() {
  return <PrepareHandoverScreen />;
}
