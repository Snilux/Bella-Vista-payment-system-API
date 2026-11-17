import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { AppText } from './AppText.js';
import { BottomSheet } from './BottomSheet.js';
import { FieldMessage } from './FieldMessage.js';
import { Icon } from './Icon.js';
import { borders, colors, layout, radii, spacing } from './theme/index.js';

// Selector (2.4 §6.3; Figma "Selector"): looks like a field with a chevron and opens a bottom
// sheet with 56-high option rows.

export type SelectOption<T extends string | number> = {
  value: T;
  label: string;
  description?: string;
};

export type SelectProps<T extends string | number> = {
  label: string;
  required?: boolean;
  options: readonly SelectOption<T>[];
  value: T | null;
  onChange: (value: T) => void;
  /** Shown while nothing is chosen. */
  placeholder?: string;
  help?: string | null;
  error?: string | null;
  /** Title of the sheet; the label by default. */
  sheetTitle?: string;
};

export function Select<T extends string | number>({
  label,
  required = false,
  options,
  value,
  onChange,
  placeholder = 'Elija una opción',
  help = null,
  error = null,
  sheetTitle,
}: SelectProps<T>) {
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.value === value) ?? null;
  const fullLabel = required ? `${label} *` : label;

  return (
    <View style={styles.container}>
      <AppText variant="label">{fullLabel}</AppText>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${selected ? selected.label : 'sin elegir'}`}
        accessibilityHint={error ?? help ?? 'Abre la lista de opciones'}
        style={[styles.box, open && styles.focused, error ? styles.invalid : null]}
      >
        <AppText
          variant="body"
          color={selected ? colors.text : colors.textSecondary}
          style={styles.value}
        >
          {selected ? selected.label : placeholder}
        </AppText>
        <Icon name="down" />
      </Pressable>
      <FieldMessage error={error} help={help} />
      <BottomSheet visible={open} onClose={() => setOpen(false)} title={sheetTitle ?? label}>
        {options.map((option) => {
          const isSelected = option.value === value;
          return (
            <Pressable
              key={String(option.value)}
              onPress={() => {
                onChange(option.value);
                setOpen(false);
              }}
              accessibilityRole="radio"
              accessibilityState={{ checked: isSelected }}
              style={[styles.option, isSelected && styles.optionSelected]}
            >
              <View style={styles.optionText}>
                <AppText variant={isSelected ? 'bodyStrong' : 'body'}>{option.label}</AppText>
                {option.description ? (
                  <AppText variant="caption" color={colors.textSecondary}>
                    {option.description}
                  </AppText>
                ) : null}
              </View>
              {isSelected ? <Icon name="check" color={colors.primaryStrong} /> : null}
            </Pressable>
          );
        })}
      </BottomSheet>
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
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
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
  value: { flex: 1 },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: layout.controlHeight,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.control,
    borderBottomWidth: borders.hairline,
    borderBottomColor: colors.divider,
  },
  optionSelected: { backgroundColor: colors.primarySoft },
  optionText: { flex: 1 },
});
