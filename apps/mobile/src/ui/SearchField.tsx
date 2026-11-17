import { type Ref, useState } from 'react';
import { Pressable, StyleSheet, TextInput, type TextInputInstance, View } from 'react-native';
import { Icon } from './Icon.js';
import {
  borders,
  colors,
  layout,
  MAX_FONT_SCALE,
  radii,
  spacing,
  typography,
} from './theme/index.js';

// Buscador (Figma "Buscador"): a field with a search icon. The 400 ms wait, the 2-letter minimum
// and cancelling the previous request belong to the screen's query hook (3.2 §11.2).

export type SearchFieldProps = {
  value: string;
  onChangeText: (text: string) => void;
  /** What can be searched; it is also the accessible label. */
  placeholder?: string;
  onSubmit?: () => void;
  autoFocus?: boolean;
  ref?: Ref<TextInputInstance>;
};

export function SearchField({
  value,
  onChangeText,
  placeholder = 'Buscar nombre, calle o folio',
  onSubmit,
  autoFocus = false,
  ref,
}: SearchFieldProps) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={[styles.box, focused && styles.focused]}>
      <Icon name="search" />
      <TextInput
        ref={ref}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textSecondary}
        accessibilityLabel={placeholder}
        accessibilityRole="search"
        returnKeyType="search"
        autoCorrect={false}
        autoCapitalize="none"
        autoFocus={autoFocus}
        onSubmitEditing={onSubmit}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        maxFontSizeMultiplier={MAX_FONT_SCALE}
        style={styles.input}
      />
      {value ? (
        <Pressable
          onPress={() => onChangeText('')}
          accessibilityRole="button"
          accessibilityLabel="Borrar búsqueda"
          style={styles.clear}
        >
          <Icon name="close" />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: layout.controlHeight,
    backgroundColor: colors.surface,
    borderWidth: borders.hairline,
    borderColor: colors.borderStrong,
    borderRadius: radii.control,
    paddingHorizontal: spacing.lg,
  },
  focused: {
    borderWidth: borders.focus,
    borderColor: colors.primary,
    paddingHorizontal: spacing.lg - 1,
  },
  input: { ...typography.body, flex: 1, color: colors.text, paddingVertical: spacing.md },
  clear: {
    minWidth: layout.touchTarget,
    minHeight: layout.touchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: -spacing.md,
  },
});
