// G-07 · Reporte comunitario
import { useLocalSearchParams } from 'expo-router';
import { CommunityReportScreen } from '../../../../src/features/reports/CommunityReportScreen.js';

// The community report (Figma G-07; RF-REP-02): opened from T-13 ("Consolidado comunitario",
// with the month) and V-01; the president's and the member's "Reportes" tab show the same.

export default function CommunityReportRoute() {
  const params = useLocalSearchParams<{ from?: string; to?: string }>();
  return (
    <CommunityReportScreen
      {...(params.from ? { from: params.from } : {})}
      {...(params.to ? { to: params.to } : {})}
    />
  );
}
