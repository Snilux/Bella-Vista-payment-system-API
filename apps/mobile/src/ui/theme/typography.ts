import type { TextStyle } from 'react-native';

// Text styles from document 2.4 §3 (Inter, the same 7 styles as in Figma).
// React Native ignores fontWeight for custom fonts on Android, so each weight is its own family.

export const fontFamilies = {
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
} as const;

/** The phone's text size is respected up to 1.4× (2.4 §3); screens are tested at 1.4×. */
export const MAX_FONT_SCALE = 1.4;

export const typography = {
  /** Headline amounts (cashbox balance, total to charge). */
  display: { fontFamily: fontFamilies.bold, fontSize: 32, lineHeight: 38 },
  /** Screen title, left aligned. */
  title: { fontFamily: fontFamilies.bold, fontSize: 26, lineHeight: 32 },
  /** Section and card titles. */
  heading: { fontFamily: fontFamilies.semibold, fontSize: 20, lineHeight: 26 },
  /** Base text and list content. */
  body: { fontFamily: fontFamilies.regular, fontSize: 18, lineHeight: 26 },
  /** Names, amounts in lists, button text. */
  bodyStrong: { fontFamily: fontFamilies.semibold, fontSize: 18, lineHeight: 26 },
  /** Field labels, tabs, table headers. */
  label: { fontFamily: fontFamilies.medium, fontSize: 16, lineHeight: 22 },
  /** Help and secondary data; never critical information. */
  caption: { fontFamily: fontFamilies.regular, fontSize: 15, lineHeight: 20 },
  /** Caption semibold: status tags (2.4 §6.5). */
  captionStrong: { fontFamily: fontFamilies.semibold, fontSize: 15, lineHeight: 20 },
} as const satisfies Record<string, TextStyle>;

export type TextVariant = keyof typeof typography;

/** Amounts use tabular figures so they line up (2.4 §3). */
export const tabularNumbers: TextStyle = { fontVariant: ['tabular-nums'] };
