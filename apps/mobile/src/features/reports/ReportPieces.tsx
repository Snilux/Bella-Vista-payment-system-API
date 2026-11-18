import type { SessionAccount } from '@bella-vista/shared';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import type { MonthRange } from '../../api/useReports.js';
import type { ReportMeta } from '../../reports/html.js';
import { exportPdf } from '../../reports/pdf.js';
import { roleDescription } from '../../session/role-labels.js';
import { Button, Notice, Select, spacing } from '../../ui/index.js';
import { periodOptions } from '../closings/closing-view.js';
import { businessToday } from '../forms/business-date.js';

// Pieces of G-06 and G-07: the month range and "Exportar a PDF".

/** The current month as a range (the reports open on it). */
export const currentRange = (): MonthRange => {
  const month = businessToday().slice(0, 7);
  return { from: month, to: month };
};

/** "Desde" and "Hasta": the last 24 months; a "Desde" after "Hasta" moves "Hasta" with it. */
export function MonthRangeFields({
  value,
  onChange,
}: {
  value: MonthRange;
  onChange: (range: MonthRange) => void;
}) {
  const options = periodOptions(businessToday().slice(0, 7));
  return (
    <View style={styles.row}>
      <View style={styles.field}>
        <Select
          label="Desde"
          options={options}
          value={value.from}
          onChange={(from) => onChange({ from, to: from > value.to ? from : value.to })}
        />
      </View>
      <View style={styles.field}>
        <Select
          label="Hasta"
          options={options}
          value={value.to}
          onChange={(to) => onChange({ from: to < value.from ? to : value.from, to })}
        />
      </View>
    </View>
  );
}

/** Who generates the PDF (role and name) and when. */
export const reportMeta = (account: SessionAccount | null): ReportMeta => ({
  generatedAt: new Date(),
  generatedBy: account ? `${account.fullName} (${roleDescription(account)})` : 'la app',
});

/** "Exportar a PDF": builds the HTML from the response on screen and opens the share sheet. */
export function ExportButton({
  title,
  html,
}: {
  title: string;
  /** Null while the report is not loaded. */
  html: (() => string) | null;
}) {
  const [exporting, setExporting] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <>
      <Button
        label="Exportar a PDF"
        loading={exporting}
        loadingLabel="Generando PDF..."
        disabledReason={html ? null : 'Espere a que cargue el reporte.'}
        onPress={async () => {
          if (!html) return;
          setExporting(true);
          setFailed(false);
          try {
            await exportPdf(html(), title);
          } catch {
            setFailed(true);
          } finally {
            setExporting(false);
          }
        }}
      />
      {failed ? (
        <Notice
          title="No se pudo generar el PDF."
          detail="Inténtelo de nuevo; si sigue fallando, reinicie la app."
        />
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  field: { flex: 1, minWidth: 150 },
});
