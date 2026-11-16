import { StyleSheet, View } from 'react-native';
import { AppText } from './AppText.js';
import { radii, type StatusTone, spacing, statusColors } from './theme/index.js';

// Etiqueta de estado (2.4 §6.5 and §2.2; Figma "Etiqueta de estado", 6 variants). The status is
// always said with a word; the color only reinforces it.

export const STATUS_LABELS: Record<StatusTone, string> = {
  paid: 'Pagado',
  pending: 'Pendiente',
  overdue: 'Vencido',
  surcharge: 'Recargo',
  advance: 'Anticipo',
  cancelled: 'Cancelado',
};

export type StatusTagProps = {
  tone: StatusTone;
  /** Another word with the same colors (e.g. "Confirmada" with the paid tone). */
  label?: string;
};

export function StatusTag({ tone, label = STATUS_LABELS[tone] }: StatusTagProps) {
  const palette = statusColors[tone];
  return (
    <View
      style={[styles.tag, { backgroundColor: palette.background }]}
      accessibilityRole="text"
      accessibilityLabel={`Estado: ${label}`}
    >
      <AppText variant="captionStrong" color={palette.text}>
        {label}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  tag: {
    alignSelf: 'flex-start',
    borderRadius: radii.tag,
    paddingVertical: spacing.xs,
    paddingHorizontal: 10,
  },
});
