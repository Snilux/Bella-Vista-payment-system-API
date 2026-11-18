import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { borders, colors, layout, radii, spacing } from './theme/index.js';

// Tarjeta de resumen (2.4 §6; Figma R-01, R-03, S-01): the warm card that groups the figures
// of a summary, or the white card of the request data. Its content is DataRow and AppText.

export type SummaryCardProps = {
  children: ReactNode;
  /** Warm (color-3) for summaries; plain (white) for record data. */
  tone?: 'warm' | 'plain';
};

export function SummaryCard({ children, tone = 'warm' }: SummaryCardProps) {
  return (
    <View style={[styles.card, tone === 'plain' ? styles.plain : styles.warm]}>{children}</View>
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
});
