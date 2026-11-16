import { useState } from 'react';
import { StyleSheet, type TextLayoutEvent, useWindowDimensions, View } from 'react-native';
import { AppText } from './AppText.js';
import { colors, spacing } from './theme/index.js';

// Dato (Figma "Dato"): label at the left in text-secondary and value at the right in Body strong.
// When the pair does not fit on one line (long value or text at 140 %) it stacks: label above,
// value below, as 2.4 §6.5 describes the label-value pair.

export type DataRowProps = {
  label: string;
  value: string;
  /** Amounts: tabular figures. */
  amount?: boolean;
};

export function DataRow({ label, value, amount = false }: DataRowProps) {
  const { width, fontScale } = useWindowDimensions();
  // Measured per screen width and text size: rotating the phone or changing the size re-measures.
  const layoutKey = `${width}:${fontScale}`;
  const [stackedFor, setStackedFor] = useState<string | null>(null);
  const stacked = stackedFor === layoutKey;

  const onTextLayout = (event: TextLayoutEvent) => {
    if (!stacked && event.nativeEvent.lines.length > 1) setStackedFor(layoutKey);
  };

  return (
    <View
      style={stacked ? styles.stacked : styles.row}
      accessible
      accessibilityLabel={`${label}: ${value}`}
      testID="data-row"
    >
      <AppText
        variant="body"
        color={colors.textSecondary}
        style={stacked ? null : styles.label}
        onTextLayout={stacked ? undefined : onTextLayout}
      >
        {label}
      </AppText>
      <AppText
        variant="bodyStrong"
        amount={amount}
        style={stacked ? null : styles.value}
        onTextLayout={stacked ? undefined : onTextLayout}
      >
        {value}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.lg },
  stacked: { flexDirection: 'column', gap: 2 },
  label: { flexShrink: 1 },
  value: { flex: 1, textAlign: 'right' },
});
