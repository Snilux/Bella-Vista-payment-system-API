import type { ReactNode } from 'react';
import { type StyleProp, StyleSheet, Text, type TextProps, type TextStyle } from 'react-native';
import {
  colors,
  MAX_FONT_SCALE,
  type TextVariant,
  tabularNumbers,
  typography,
} from './theme/index.js';

export type AppTextProps = Omit<TextProps, 'style' | 'maxFontSizeMultiplier'> & {
  variant?: TextVariant;
  color?: string;
  /** Amounts: tabular figures, right aligned by the parent (2.4 §3). */
  amount?: boolean;
  style?: StyleProp<TextStyle>;
  children?: ReactNode;
};

/**
 * Every text of the app goes through here: Inter styles from 2.4 §3 and the phone's text size
 * up to 1.4×. Text is never cut (no numberOfLines) unless a caller asks for it explicitly.
 */
export function AppText({
  variant = 'body',
  color = colors.text,
  amount = false,
  style,
  children,
  ...rest
}: AppTextProps) {
  return (
    <Text
      {...rest}
      maxFontSizeMultiplier={MAX_FONT_SCALE}
      style={[typography[variant], { color }, amount && styles.amount, style]}
    >
      {children}
    </Text>
  );
}

const styles = StyleSheet.create({ amount: tabularNumbers });
