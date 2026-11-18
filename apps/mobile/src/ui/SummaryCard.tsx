import { formatMoney } from '@bella-vista/shared';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { AppText } from './AppText.js';
import { borders, colors, layout, radii, spacing } from './theme/index.js';

// Tarjeta de resumen (2.4 §6; Figma J-01, G-04, F-03, R-01, R-03): the warm card that groups the
// figures of a summary, or the white card of a record's data. Optionally a heading with its big
// amount ("Debo tener $3,450.00", "Debe $450.00") and a total under a line ("Total $200.00").
// The content in between is DataRow and AppText.

export type SummaryCardProps = {
  children?: ReactNode;
  /** Warm (color-3) for summaries; plain (white) for record data. */
  tone?: 'warm' | 'plain';
  /** The heading: a label over a big amount in cents. */
  heading?: { label: string; amountCents: number };
  /** The closing line under a divider, e.g. the total of a payment. */
  total?: { label: string; amountCents: number };
};

export function SummaryCard({ children, tone = 'warm', heading, total }: SummaryCardProps) {
  return (
    <View style={[styles.card, tone === 'plain' ? styles.plain : styles.warm]}>
      {heading ? (
        <View style={styles.heading}>
          <AppText variant="label" color={colors.textSecondary}>
            {heading.label}
          </AppText>
          <AppText
            variant="display"
            amount
            accessibilityLabel={`${heading.label}: ${formatMoney(heading.amountCents)}`}
          >
            {formatMoney(heading.amountCents)}
          </AppText>
        </View>
      ) : null}
      {children}
      {total ? (
        <View style={styles.total}>
          <AppText variant="bodyStrong" style={styles.totalLabel}>
            {total.label}
          </AppText>
          <AppText variant="title" amount>
            {formatMoney(total.amountCents)}
          </AppText>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radii.card, padding: layout.cardPadding, gap: spacing.md },
  warm: { backgroundColor: colors.surfaceWarm },
  plain: {
    backgroundColor: colors.surface,
    borderWidth: borders.hairline,
    borderColor: colors.divider,
  },
  heading: { gap: spacing.xs },
  total: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.md,
    borderTopWidth: borders.hairline,
    borderTopColor: colors.divider,
    paddingTop: spacing.md,
  },
  totalLabel: { flex: 1, minWidth: 80 },
});
