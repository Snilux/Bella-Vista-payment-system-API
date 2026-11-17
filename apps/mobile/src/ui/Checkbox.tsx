import { Pressable, StyleSheet, View } from 'react-native';
import { AppText } from './AppText.js';
import { Icon } from './Icon.js';
import { borders, colors, layout, radii, spacing } from './theme/index.js';

// Casilla (2.4 §6.3): 28 × 28, border-strong outline, checked in primary-strong with a white
// check; the whole row is touchable.

/** Only the 28 × 28 box; MonthRow and other rows put it inside their own touchable row. */
export function CheckboxBox({ checked }: { checked: boolean }) {
  return (
    <View style={[styles.box, checked && styles.boxChecked]}>
      {checked ? <Icon name="check" size={20} color={colors.onFill} /> : null}
    </View>
  );
}

export type CheckboxProps = {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  description?: string;
};

export function Checkbox({ label, checked, onChange, description }: CheckboxProps) {
  return (
    <Pressable
      onPress={() => onChange(!checked)}
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      accessibilityState={{ checked }}
      style={styles.row}
    >
      <CheckboxBox checked={checked} />
      <View style={styles.text}>
        <AppText variant="body">{label}</AppText>
        {description ? (
          <AppText variant="caption" color={colors.textSecondary}>
            {description}
          </AppText>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: layout.touchTarget,
    paddingVertical: spacing.sm,
  },
  box: {
    width: layout.checkbox,
    height: layout.checkbox,
    borderRadius: radii.tag - 2,
    borderWidth: borders.focus,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxChecked: { backgroundColor: colors.primaryStrong, borderColor: colors.primaryStrong },
  text: { flex: 1 },
});
