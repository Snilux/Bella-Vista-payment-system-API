import type { ViewStyle } from 'react-native';
import { colors } from './colors.js';

// Spacing, shape and elevation from document 2.4 §4.

/** 4-point scale: 4, 8, 12, 16, 24, 32, 48. */
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const;

export const layout = {
  /** Side margin of every screen. */
  screenMargin: 20,
  /** Gap between form fields. */
  fieldGap: 20,
  /** Minimum touch area (48 × 48). */
  touchTarget: 48,
  /** Height of fields, primary and secondary buttons, and bottom sheet options. */
  controlHeight: 56,
  /** Menu row height. */
  menuRowHeight: 64,
  /** Tab bar height and the active tab indicator. */
  tabBarHeight: 72,
  tabIndicator: 3,
  /** Padding of summary cards and record cards. */
  cardPadding: 20,
  /** Checkbox side and radio circle. */
  checkbox: 28,
  radio: 24,
} as const;

export const radii = {
  /** Status tags. */
  tag: 8,
  /** Fields and buttons. */
  control: 12,
  /** Cards. */
  card: 16,
  /** Bottom sheets. */
  sheet: 24,
  /** Chips (pill). */
  pill: 999,
} as const;

export const borders = {
  hairline: 1,
  /** Secondary button outline. */
  button: 1.5,
  /** Focused or invalid field. */
  focus: 2,
} as const;

export const iconSizes = {
  list: 24,
  tab: 26,
  success: 72,
  empty: 48,
} as const;

/** No strong shadows: only the fixed bottom bar and the sheets get a soft one (2.4 §4). */
export const softShadow: ViewStyle = {
  shadowColor: colors.shadow,
  shadowOpacity: 0.12,
  shadowRadius: 12,
  shadowOffset: { width: 0, height: -2 },
  elevation: 8,
};

/** Disabled controls: 40 % opacity with a sentence that explains why (2.4 §6.1). */
export const DISABLED_OPACITY = 0.4;
