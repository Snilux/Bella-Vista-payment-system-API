import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { AppText } from './AppText.js';
import { borders, colors, DISABLED_OPACITY, layout, radii, spacing } from './theme/index.js';

// Botón (2.4 §6.1; Figma "Botón": 4 types × enabled/disabled).

export type ButtonVariant = 'primary' | 'secondary' | 'text' | 'danger';

export type ButtonProps = {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  /** A disabled button always says why, in a sentence under it (2.4 §6.1). */
  disabledReason?: string | null;
  /** Saving: shows "Guardando..." and ignores any other press (reinforces idempotency). */
  loading?: boolean;
  loadingLabel?: string;
  accessibilityHint?: string;
};

const VARIANTS = {
  primary: { background: colors.primaryStrong, border: colors.primaryStrong, text: colors.onFill },
  secondary: {
    background: colors.surface,
    border: colors.primaryStrong,
    text: colors.primaryStrong,
  },
  text: { background: 'transparent', border: 'transparent', text: colors.primaryStrong },
  danger: { background: colors.error, border: colors.error, text: colors.onFill },
} as const;

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabledReason = null,
  loading = false,
  loadingLabel = 'Guardando...',
  accessibilityHint,
}: ButtonProps) {
  const disabled = Boolean(disabledReason);
  const inactive = disabled || loading;
  const look = VARIANTS[variant];

  return (
    <View style={styles.wrapper}>
      <Pressable
        onPress={inactive ? undefined : onPress}
        disabled={inactive}
        accessibilityRole="button"
        accessibilityLabel={loading ? loadingLabel : label}
        accessibilityHint={disabledReason ?? accessibilityHint}
        accessibilityState={{ disabled: inactive, busy: loading }}
        style={({ pressed }) => [
          styles.base,
          variant === 'text' ? styles.textVariant : styles.filled,
          {
            backgroundColor: look.background,
            borderColor: look.border,
            borderWidth: variant === 'secondary' ? borders.button : 0,
          },
          disabled && styles.disabled,
          pressed && !inactive && styles.pressed,
        ]}
      >
        {loading ? <ActivityIndicator color={look.text} /> : null}
        <AppText variant="bodyStrong" color={look.text} style={styles.label}>
          {loading ? loadingLabel : label}
        </AppText>
      </Pressable>
      {disabledReason ? (
        <AppText variant="caption" color={colors.textSecondary} style={styles.reason}>
          {disabledReason}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { alignSelf: 'stretch' },
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    borderRadius: radii.control,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  filled: { minHeight: layout.controlHeight },
  textVariant: { minHeight: layout.touchTarget },
  disabled: { opacity: DISABLED_OPACITY },
  pressed: { opacity: 0.85 },
  label: { textAlign: 'center', flexShrink: 1 },
  reason: { marginTop: spacing.sm, textAlign: 'center' },
});
