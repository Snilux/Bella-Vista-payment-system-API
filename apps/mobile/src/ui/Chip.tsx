import { Pressable, StyleSheet } from 'react-native';
import { AppText } from './AppText.js';
import { borders, colors, layout, radii, spacing } from './theme/index.js';

// Chip (Figma "Chip"): list filters such as "Con atraso". Active: filled primary-strong with white
// text; inactive: white with a border-strong outline.

export type ChipProps = {
  label: string;
  selected: boolean;
  onPress: () => void;
};

const CHIP_HEIGHT = 44;

export function Chip({ label, selected, onPress }: ChipProps) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Filtro: ${label}`}
      accessibilityState={{ selected }}
      // 44 high as in Figma; the hit slop takes the touch area to 48.
      hitSlop={(layout.touchTarget - CHIP_HEIGHT) / 2}
      style={[styles.chip, selected ? styles.selected : styles.unselected]}
    >
      <AppText variant="body" color={selected ? colors.onFill : colors.text}>
        {label}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    alignSelf: 'flex-start',
    justifyContent: 'center',
    minHeight: CHIP_HEIGHT,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radii.pill,
    borderWidth: borders.hairline,
  },
  selected: { backgroundColor: colors.primaryStrong, borderColor: colors.primaryStrong },
  unselected: { backgroundColor: colors.surface, borderColor: colors.borderStrong },
});
