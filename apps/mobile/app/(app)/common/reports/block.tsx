// G-06 · Reporte de padrón por manzana
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useBlocks } from '../../../../src/api/useOrganization.js';
import { type MonthRange, useBlockReport } from '../../../../src/api/useReports.js';
import {
  currentRange,
  ExportButton,
  MonthRangeFields,
  reportMeta,
} from '../../../../src/features/reports/ReportPieces.js';
import {
  blockSummaryRows,
  rangeLabel,
  unitRow,
} from '../../../../src/features/reports/report-view.js';
import { blockReportHtml } from '../../../../src/reports/block-report.js';
import { useAccount } from '../../../../src/session/session-store.js';
import {
  AppText,
  DataRow,
  Header,
  ListRow,
  ScreenLayout,
  ScreenState,
  Select,
  SummaryCard,
  screenStatusOf,
  spacing,
} from '../../../../src/ui/index.js';

// The registry report of a block (Figma G-06; RF-REP-01; D-25, D-26): block (a leader only
// theirs, the API refuses others with OUT_OF_SCOPE) and months; the API's figures on screen, and
// "Exportar a PDF" builds the PDF on the phone from that same response.

export default function BlockReportScreen() {
  const account = useAccount();
  const params = useLocalSearchParams<{ blockId?: string }>();
  const leader = account?.role === 'block_leader';
  const blocks = useBlocks();
  const [blockId, setBlockId] = useState<number | null>(
    leader ? (account?.blockId ?? null) : params.blockId ? Number(params.blockId) : null,
  );
  const [range, setRange] = useState<MonthRange>(currentRange);
  const query = useBlockReport(blockId, range);
  const report = query.data;

  return (
    <ScreenLayout
      footer={
        <ExportButton
          title="Padrón por manzana"
          html={report ? () => blockReportHtml(report, reportMeta(account)) : null}
        />
      }
    >
      <Header
        title="Padrón por manzana"
        {...(report ? { subtitle: `${report.block.code} · ${rangeLabel(report.range)}` } : {})}
        onBack={() => router.back()}
      />
      {leader ? null : (
        <Select
          label="Manzana"
          required
          options={(blocks.data ?? []).map((block) => ({ value: block.id, label: block.fullCode }))}
          value={blockId}
          onChange={setBlockId}
          placeholder="Elija la manzana"
        />
      )}
      <MonthRangeFields value={range} onChange={setRange} />
      {blockId === null ? (
        <AppText variant="body">Elija la manzana para ver su padrón.</AppText>
      ) : (
        <ScreenState
          status={screenStatusOf(query)}
          error={query.error}
          onRetry={() => void query.refetch()}
        >
          {report ? (
            <>
              <SummaryCard>
                {blockSummaryRows(report).map((row) => (
                  <DataRow key={row.label} label={row.label} value={row.value} amount />
                ))}
              </SummaryCard>
              {report.connections.map((connection) => (
                <View key={connection.id} style={styles.connection}>
                  <AppText variant="heading">{`Toma ${connection.folio} · ${connection.address}`}</AppText>
                  {connection.units.map((unit) => {
                    const row = unitRow(unit);
                    return (
                      <ListRow
                        key={unit.id}
                        title={row.title}
                        subtitle={row.detail}
                        tag={row.tag}
                        onPress={() => router.push(`/common/units/${unit.id}`)}
                      />
                    );
                  })}
                </View>
              ))}
            </>
          ) : null}
        </ScreenState>
      )}
    </ScreenLayout>
  );
}

const styles = StyleSheet.create({
  connection: { gap: spacing.xs },
});
