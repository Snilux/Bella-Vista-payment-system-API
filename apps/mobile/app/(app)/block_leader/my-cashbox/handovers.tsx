// J-04 · Mis entregas
import { MyHandoversScreen } from '../../../../src/features/cashboxes/CashboxScreens.js';

// The leader's handovers (Figma J-04): pending, confirmed, with a difference or withdrawn. A
// pending one can be withdrawn while the treasurer has not confirmed it.

export default function BlockLeaderHandovers() {
  return <MyHandoversScreen base="/block_leader/my-cashbox" />;
}
