// R-04 · Cortes por revisar (pestaña Cortes del vocal)
import { ClosingsToReview } from '../../../src/features/closings/ClosingsToReview.js';

// The member reviews counted closings but never closes them (M8): no "Por cerrar" chip.

export default function MemberClosingsTab() {
  return <ClosingsToReview />;
}
