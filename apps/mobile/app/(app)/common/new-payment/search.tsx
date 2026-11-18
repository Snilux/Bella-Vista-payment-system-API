// F-01 · Buscar familia
import { FamilySearch } from '../../../../src/features/billing/FamilySearch.js';

// The first step of the payment flow when it is not opened from a family (G-04) or a request
// (P-06), which go straight to F-02. The Cobrar tabs show the same search.

export default function NewPaymentSearch() {
  return <FamilySearch />;
}
