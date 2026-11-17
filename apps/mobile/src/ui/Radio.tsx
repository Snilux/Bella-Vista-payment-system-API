import { Pressable, StyleSheet, View } from 'react-native';
import { AppText } from './AppText.js';
import { borders, colors, layout, radii, spacing } from './theme/index.js';

// Opción única (2.4 §6.3; Figma "Opción"): a row with a 24 circle and the text, for questions
// such as "Es la misma persona / Es otra persona". The whole row is touchable.

export type RadioProps = {
  label: string;
  selected: boolean;
  onPress: () => void;
  description?: string;
};

export function Radio({ label, selected, onPress, description }: RadioProps) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityState={{ checked: selected }}
      style={[styles.row, selected && styles.rowSelected]}
    >
      <View style={[styles.circle, selected && styles.circleSelected]}>
        {selected ? <View style={styles.dot} /> : null}
      </View>
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

const DOT = 12;

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: layout.controlHeight,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.surface,
    borderWidth: borders.hairline,
    borderColor: colors.divider,
    borderRadius: radii.control,
  },
  rowSelected: {
    backgroundColor: colors.primarySoft,
    borderWidth: borders.focus,
    borderColor: colors.primaryStrong,
    paddingHorizontal: spacing.lg - 1,
  },
  circle: {
    width: layout.radio,
    height: layout.radio,
    borderRadius: layout.radio / 2,
    borderWidth: borders.focus,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  circleSelected: { borderColor: colors.primaryStrong },
  dot: {
    width: DOT,
    height: DOT,
    borderRadius: DOT / 2,
    backgroundColor: colors.primaryStrong,
  },
  text: { flex: 1 },
});
