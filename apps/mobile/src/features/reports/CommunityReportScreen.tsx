import { formatMoney } from '@bella-vista/shared';
import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { type MonthRange, useCommunityReport } from '../../api/useReports.js';
import { communityReportHtml } from '../../reports/community-report.js';
import { useAccount } from '../../session/session-store.js';
import {
  AppText,
  DataRow,
  Header,
  MenuRow,
  ScreenLayout,
  ScreenState,
  SummaryCard,
  screenStatusOf,
  spacing,
} from '../../ui/index.js';
import { currentRange, ExportButton, MonthRangeFields, reportMeta } from './ReportPieces.js';
import {
  blockFigureRows,
  committeeRows,
  communitySummaryRows,
  rangeLabel,
  sectionTitle,
} from './report-view.js';

// G-07 · Reporte comunitario (RF-REP-02; D-25, D-26): the month range, the API's totals, the
// committee cashbox and each section with its blocks (a section opens to show them). "Exportar
// a PDF" builds the PDF on the phone from the same response.

const PERIOD = /^\d{4}-\d{2}$/;

export function CommunityReportScreen({
  from,
  to,
  withinTabs = false,
}: {
  from?: string;
  to?: string;
  withinTabs?: boolean;
}) {
  const account = useAccount();
  const [range, setRange] = useState<MonthRange>(() =>
    from && PERIOD.test(from)
      ? { from, to: to && PERIOD.test(to) && to >= from ? to : from }
      : currentRange(),
  );
  const [openSection, setOpenSection] = useState<number | null>(null);
  const query = useCommunityReport(true, range);
  const report = query.data;

  return (
    <ScreenLayout
      withinTabs={withinTabs}
      footer={
        <ExportButton
          title="Reporte comunitario"
          html={report ? () => communityReportHtml(report, reportMeta(account)) : null}
        />
      }
    >
      <Header
        title="Reporte comunitario"
        {...(report ? { subtitle: rangeLabel(report.range) } : {})}
        {...(withinTabs ? {} : { onBack: () => router.back() })}
      />
      <MonthRangeFields value={range} onChange={setRange} />
      <ScreenState
        status={screenStatusOf(query)}
        error={query.error}
        onRetry={() => void query.refetch()}
      >
        {report ? (
          <>
            <SummaryCard>
              {communitySummaryRows(report).map((row) => (
                <DataRow key={row.label} label={row.label} value={row.value} amount />
              ))}
            </SummaryCard>
            <AppText variant="heading">Caja del comité</AppText>
            <SummaryCard tone="plain">
              {committeeRows(report).map((row) => (
                <DataRow key={row.label} label={row.label} value={row.value} amount />
              ))}
            </SummaryCard>
            {report.sections.map((section) => (
              <View key={section.id} style={styles.section}>
                <MenuRow
                  label={`${sectionTitle(section)} · recaudado ${blockFigureRows(section.totals)[1]?.value ?? ''}`}
                  icon="report"
                  active={openSection === section.id}
                  onPress={() => setOpenSection(openSection === section.id ? null : section.id)}
                />
                {openSection === section.id
                  ? section.blocks.map((block) => (
                      <SummaryCard key={block.id} tone="plain">
                        <AppText variant="bodyStrong">
                          {`Manzana ${block.code}${block.leaderName ? ` · ${block.leaderName}` : ''}`}
                        </AppText>
                        {blockFigureRows(block).map((row) => (
                          <DataRow key={row.label} label={row.label} value={row.value} amount />
                        ))}
                      </SummaryCard>
                    ))
                  : null}
              </View>
            ))}
            {report.supportCashboxes.length > 0 ? (
              <AppText variant="heading">Cajas de apoyo</AppText>
            ) : null}
            {report.supportCashboxes.map((box) => (
              <DataRow key={box.id} label={box.label} value={formatMoney(box.balance)} amount />
            ))}
          </>
        ) : null}
      </ScreenState>
    </ScreenLayout>
  );
}

const styles = StyleSheet.create({
  section: { gap: spacing.sm },
});
