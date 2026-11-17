import { type ReactNode, type Ref, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  TextInput,
  type TextInputInstance,
  type TextInputProps,
  View,
} from 'react-native';
import { AppText } from './AppText.js';
import { FieldMessage } from './FieldMessage.js';
import {
  borders,
  colors,
  layout,
  MAX_FONT_SCALE,
  radii,
  spacing,
  typography,
} from './theme/index.js';

// Campo (2.4 §6.2; Figma "Campo": normal, focus, error). Full border instead of an underline.

export type TextFieldProps = Omit<
  TextInputProps,
  'style' | 'placeholder' | 'secureTextEntry' | 'maxFontSizeMultiplier' | 'ref'
> & {
  label: string;
  /** Required fields end their label in "*". */
  required?: boolean;
  /** Help in Caption under the field; replaced by the error when there is one. */
  help?: string | null;
  error?: string | null;
  /** Password: a "Mostrar" / "Ocultar" text button inside the field. */
  password?: boolean;
  /** Fixed text before the value (the "$" of an amount). */
  prefix?: string;
  /** Placeholder is an example of the value, never the label (2.4 §6.2). */
  example?: string;
  /** Extra content inside the field, at the right (e.g. a chevron). */
  trailing?: ReactNode;
  ref?: Ref<TextInputInstance>;
};

export function TextField({
  label,
  required = false,
  help = null,
  error = null,
  password = false,
  prefix,
  example,
  trailing,
  onFocus,
  onBlur,
  ref,
  ...inputProps
}: TextFieldProps) {
  const [focused, setFocused] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const fullLabel = required ? `${label} *` : label;

  return (
    <View style={styles.container}>
      <AppText variant="label">{fullLabel}</AppText>
      <View style={[styles.box, focused && styles.focused, error ? styles.invalid : null]}>
        {prefix ? (
          <AppText variant="body" amount color={colors.textSecondary}>
            {prefix}
          </AppText>
        ) : null}
        <TextInput
          {...inputProps}
          ref={ref}
          accessibilityLabel={required ? `${label}, obligatorio` : label}
          accessibilityHint={error ?? help ?? undefined}
          placeholder={example}
          placeholderTextColor={colors.textSecondary}
          secureTextEntry={password && !revealed}
          maxFontSizeMultiplier={MAX_FONT_SCALE}
          onFocus={(event) => {
            setFocused(true);
            onFocus?.(event);
          }}
          onBlur={(event) => {
            setFocused(false);
            onBlur?.(event);
          }}
          style={[styles.input, prefix ? styles.amount : null]}
        />
        {password ? (
          <Pressable
            onPress={() => setRevealed((value) => !value)}
            accessibilityRole="button"
            accessibilityLabel={revealed ? 'Ocultar contraseña' : 'Mostrar contraseña'}
            hitSlop={spacing.sm}
            style={styles.reveal}
          >
            <AppText variant="label" color={colors.primaryStrong}>
              {revealed ? 'Ocultar' : 'Mostrar'}
            </AppText>
          </Pressable>
        ) : null}
        {trailing}
      </View>
      <FieldMessage error={error} help={help} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: spacing.sm, alignSelf: 'stretch' },
  box: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: layout.controlHeight,
    backgroundColor: colors.surface,
    borderWidth: borders.hairline,
    borderColor: colors.borderStrong,
    borderRadius: radii.control,
    // The border grows to 2 on focus or error; padding shrinks by 1 so the text does not move.
    paddingHorizontal: spacing.lg,
  },
  focused: {
    borderWidth: borders.focus,
    borderColor: colors.primary,
    paddingHorizontal: spacing.lg - 1,
  },
  invalid: {
    borderWidth: borders.focus,
    borderColor: colors.error,
    paddingHorizontal: spacing.lg - 1,
  },
  input: {
    ...typography.body,
    flex: 1,
    color: colors.text,
    paddingVertical: spacing.md,
  },
  amount: { fontVariant: ['tabular-nums'] },
  reveal: { minHeight: layout.touchTarget, justifyContent: 'center' },
});
