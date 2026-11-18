// J-02 · Mi caja
import { MyCashboxScreen } from '../../../../src/features/cashboxes/CashboxScreens.js';

// The block leader's cashbox (Figma J-02; 3.2 §10.5; D-16): "Debo tener" with the opening
// balance, what was collected, what was handed over and what waits for the treasurer ("Por
// confirmar": a handover only leaves the cashbox once confirmed), and the way to its movements
// (G-09) and handovers (J-04). The closings (J-05) arrive in M8.

export default function BlockLeaderMyCashbox() {
  return <MyCashboxScreen title="Mi caja" base="/block_leader/my-cashbox" withinTabs />;
}
