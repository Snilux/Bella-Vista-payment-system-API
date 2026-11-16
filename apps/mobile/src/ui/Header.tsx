import { Pressable, StyleSheet, View } from 'react-native';
import { AppText } from './AppText.js';
import { Icon } from './Icon.js';
import { colors, layout, spacing } from './theme/index.js';

// Encabezado (2.4 §6.6; Figma "Encabezado"): "Atrás" with an arrow at the left, "Paso X de Y" at
// the right in multi-step flows, a large left-aligned Title and an optional subtitle.

export type HeaderProps = {
  title: string;
  subtitle?: string;
  /** Without it there is no back button (first level of a tab). */
  onBack?: () => void;
  backLabel?: string;
  step?: { current: number; total: number };
};

export function Header({ title, subtitle, onBack, backLabel = 'Atrás', step }: HeaderProps) {
  const showTopRow = Boolean(onBack || step);
  return (
    <View style={styles.container}>
      {showTopRow ? (
        <View style={styles.topRow}>
          {onBack ? (
            <Pressable
              onPress={onBack}
              accessibilityRole="button"
              accessibilityLabel={backLabel}
              hitSlop={spacing.sm}
              style={styles.back}
            >
              <Icon name="back" color={colors.primaryStrong} />
              <AppText variant="label" color={colors.primaryStrong}>
                {backLabel}
              </AppText>
            </Pressable>
          ) : (
            <View />
          )}
          {step ? (
            <AppText variant="label" color={colors.textSecondary}>
              {`Paso ${step.current} de ${step.total}`}
            </AppText>
          ) : null}
        </View>
      ) : null}
      <AppText variant="title" accessibilityRole="header">
        {title}
      </AppText>
      {subtitle ? (
        <AppText variant="body" color={colors.textSecondary}>
          {subtitle}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: spacing.sm, paddingBottom: spacing.lg },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  back: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minHeight: layout.touchTarget,
    marginLeft: -spacing.xs,
  },
});
