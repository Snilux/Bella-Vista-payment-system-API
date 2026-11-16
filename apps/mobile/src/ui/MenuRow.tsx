import { memo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { AppText } from './AppText.js';
import { Icon, type IconName } from './Icon.js';
import { borders, colors, layout, spacing } from './theme/index.js';

// Fila de menú (2.4 §6.5; Figma "Fila de menú"): icon 24, text Body, optional count and a
// chevron; 64 high with a divider; the active row gets primary-soft.

export type MenuRowProps = {
  label: string;
  onPress: () => void;
  icon?: IconName;
  /** A number at the right (e.g. "Familias con recargo 7"). */
  count?: number;
  active?: boolean;
};

export const MenuRow = memo(function MenuRow({
  label,
  onPress,
  icon,
  count,
  active = false,
}: MenuRowProps) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={count === undefined ? label : `${label}: ${count}`}
      accessibilityState={{ selected: active }}
      style={({ pressed }) => [styles.row, (active || pressed) && styles.active]}
    >
      {icon ? <Icon name={icon} color={active ? colors.primary : colors.textSecondary} /> : null}
      <AppText variant="body" style={styles.label}>
        {label}
      </AppText>
      {count === undefined ? null : (
        <AppText variant="bodyStrong" amount>
          {count}
        </AppText>
      )}
      <View style={styles.chevron}>
        <Icon name="forward" />
      </View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    minHeight: layout.menuRowHeight,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xs,
    borderBottomWidth: borders.hairline,
    borderBottomColor: colors.divider,
  },
  active: { backgroundColor: colors.primarySoft },
  label: { flex: 1 },
  chevron: { marginLeft: -spacing.xs },
});
