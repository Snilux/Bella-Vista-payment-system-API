// R-06 · Mi caja de apoyo
import { router } from 'expo-router';
import { MyCashboxScreen } from '../../../../../src/features/cashboxes/CashboxScreens.js';

// The president's support cashbox (Figma R-06; D-07): what they collected supporting a block,
// handed over to the treasurer like a block leader's (same rules, D-16).

export default function PresidentSupportCashbox() {
  return (
    <MyCashboxScreen
      title="Mi caja de apoyo"
      subtitle="Cobros hechos en apoyo a manzanas"
      base="/president/more/support-cashbox"
      support
      onBack={() => router.back()}
    />
  );
}
