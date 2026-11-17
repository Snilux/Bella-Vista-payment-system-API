import { formatMoney } from '@bella-vista/shared';
import { memo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { AppText } from './AppText.js';
import { StatusTag } from './StatusTag.js';
import { borders, colors, layout, type StatusTone, spacing } from './theme/index.js';

// Fila de lista (Figma "Fila de lista"): title in Body with a Caption under it, and at the right
// an optional status tag and an amount; divider at the bottom. Used for months of G-04,
// movements and other plain lists.

export type ListRowProps = {
  title: string;
  subtitle?: string;
  tag?: { tone: StatusTone; label?: string };
  amountCents?: number;
  onPress?: () => void;
};

export const ListRow = memo(function ListRow({
  title,
  subtitle,
  tag,
  amountCents,
  onPress,
}: ListRowProps) {
  const amount = amountCents === undefined ? null : formatMoney(amountCents);
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      style={({ pressed }) => [styles.row, pressed && onPress ? styles.pressed : null]}
    >
      <View style={styles.main}>
        <AppText variant="body">{title}</AppText>
        {subtitle ? (
          <AppText variant="caption" color={colors.textSecondary}>
            {subtitle}
          </AppText>
        ) : null}
      </View>
      <View style={styles.side}>
        {tag ? <StatusTag tone={tag.tone} {...(tag.label ? { label: tag.label } : {})} /> : null}
        {amount ? (
          <AppText variant="bodyStrong" amount style={styles.amount}>
            {amount}
          </AppText>
        ) : null}
      </View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.md,
    minHeight: layout.menuRowHeight,
    paddingVertical: spacing.md,
    borderBottomWidth: borders.hairline,
    borderBottomColor: colors.divider,
  },
  pressed: { backgroundColor: colors.primarySoft },
  main: { flex: 1, minWidth: 140, gap: 2 },
  side: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginLeft: 'auto' },
  amount: { textAlign: 'right' },
});
