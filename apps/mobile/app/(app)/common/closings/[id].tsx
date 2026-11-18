// G-08 · Corte (detalle)
import { router, useLocalSearchParams } from 'expo-router';
import { useClosing } from '../../../../src/api/useClosings.js';
import { cashboxTitle } from '../../../../src/features/cashboxes/cashbox-view.js';
import { ClosingDetail } from '../../../../src/features/closings/ClosingDetail.js';
import { CLOSING_TAGS, closingTitle } from '../../../../src/features/closings/closing-view.js';
import { Header, ScreenLayout, ScreenState, screenStatusOf } from '../../../../src/ui/index.js';

// A cashbox closing (Figma G-08; 3.2 §10.2; D-14): the API's figures, the count and the
// difference; the actions depend on the role and the status (ClosingDetail). Opened from R-04,
// T-13, J-05 and S-07.

export default function ClosingScreen() {
  const params = useLocalSearchParams<{ id?: string }>();
  const id = Number(params.id);
  const query = useClosing(Number.isInteger(id) ? id : null);
  const closing = query.data;
  const header = (
    <Header
      title={closing ? closingTitle(closing) : 'Corte de caja'}
      {...(closing
        ? { subtitle: `${cashboxTitle(closing.cashbox)} · ${CLOSING_TAGS[closing.status].label}` }
        : {})}
      onBack={() => router.back()}
    />
  );
  if (!closing) {
    return (
      <ScreenLayout>
        {header}
        <ScreenState
          status={screenStatusOf(query)}
          error={query.error}
          onRetry={() => void query.refetch()}
        />
      </ScreenLayout>
    );
  }
  return <ClosingDetail closing={closing} header={header} />;
}
