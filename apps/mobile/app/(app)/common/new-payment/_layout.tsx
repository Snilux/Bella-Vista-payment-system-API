import { Stack } from 'expo-router';
import { PaymentFlowProvider } from '../../../../src/features/billing/PaymentFlow.js';
import { colors } from '../../../../src/ui/index.js';

// The payment flow (F-01 to F-04, 3.2 §10.3). Its state (family, months, folio and the key of an
// unanswered attempt) lives here: going back keeps it; leaving the flow unmounts this layout and
// forgets it.

export default function NewPaymentLayout() {
  return (
    <PaymentFlowProvider>
      <Stack
        screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}
      />
    </PaymentFlowProvider>
  );
}
