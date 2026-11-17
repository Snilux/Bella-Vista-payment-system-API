import { formatMoney, formatPeriod } from '@bella-vista/shared';
import { memo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { AppText } from './AppText.js';
import { CheckboxBox } from './Checkbox.js';
import { StatusTag } from './StatusTag.js';
import {
  borders,
  colors,
  DISABLED_OPACITY,
  layout,
  radii,
  type StatusTone,
  spacing,
} from './theme/index.js';

// Fila de mes (2.4 §6.4; Figma "Fila de mes"): checkbox, month, status tag, breakdown in
// Caption and the total at the right. The component only paints: which months get checked
// (chronological order, D-03) is decided by the shared domain function, never here.

export type MonthRowProps = {
  /** AAAA-MM. */
  period: string;
  tone: StatusTone;
  /** Monthly fee and surcharge in cents; the breakdown is shown when there is a surcharge. */
  baseCents: number;
  surchargeCents: number;
  totalCents: number;
  checked: boolean;
  onToggle: () => void;
  /** Advance months stay disabled while overdue months are unchecked (2.4 §6.4). */
  disabled?: boolean;
};

export const MonthRow = memo(function MonthRow({
  period,
  tone,
  baseCents,
  surchargeCents,
  totalCents,
  checked,
  onToggle,
  disabled = false,
}: MonthRowProps) {
  const month = formatPeriod(period);
  const total = formatMoney(totalCents);
  const breakdown =
    surchargeCents > 0
      ? `${formatMoney(baseCents)} + recargo ${formatMoney(surchargeCents)}`
      : null;

  return (
    <Pressable
      onPress={disabled ? undefined : onToggle}
      disabled={disabled}
      accessibilityRole="checkbox"
      accessibilityLabel={[month, breakdown, `total ${total}`].filter(Boolean).join(', ')}
      accessibilityState={{ checked, disabled }}
      style={[styles.row, checked && styles.checked, disabled && styles.disabled]}
    >
      <CheckboxBox checked={checked} />
      <View style={styles.main}>
        <AppText variant="bodyStrong">{month}</AppText>
        {breakdown ? (
          <AppText variant="caption" color={colors.textSecondary} amount>
            {breakdown}
          </AppText>
        ) : null}
      </View>
      <View style={styles.side}>
        <StatusTag tone={tone} />
        <AppText variant="bodyStrong" amount style={styles.total}>
          {total}
        </AppText>
      </View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: layout.menuRowHeight,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.surface,
    borderWidth: borders.hairline,
    borderColor: colors.divider,
    borderRadius: radii.control,
  },
  checked: { backgroundColor: colors.primarySoft },
  disabled: { opacity: DISABLED_OPACITY },
  main: { flex: 1, gap: spacing.xs },
  side: { alignItems: 'flex-end', gap: spacing.sm, flexShrink: 0 },
  total: { textAlign: 'right' },
});
