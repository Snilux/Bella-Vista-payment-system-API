// Color tokens from document 2.4 §2 (same names as the Figma variables). Light theme only (2.4 §1.7).

export const colors = {
  /** color-1: identity — active icons, card headers, focus border, active tab, large elements. */
  primary: '#668983',
  /** Darker primary for contrast (6.1:1 on white): primary button, links, active tab text. */
  primaryStrong: '#4A6762',
  /** Selected row and active chip background. */
  primarySoft: '#E4ECEA',
  /** color-2: app background. */
  background: '#F8F8F8',
  /** Cards, fields, tab bar. */
  surface: '#FFFFFF',
  /** color-3: summary cards, page notices, report header. */
  surfaceWarm: '#F4EEE4',
  text: '#1F2928',
  textSecondary: '#55605E',
  /** Field and checkbox borders (3.2:1). */
  borderStrong: '#8A9391',
  /** List separators and card borders. */
  divider: '#E6E1D8',
  /** Text on dark fills (primary and danger buttons, surcharge tag). */
  onFill: '#FFFFFF',
  /** Invalid field border and message; danger button fill. */
  error: '#A1281F',
  /** Success screen icon (same green as the "Pagado" status). */
  success: '#24694B',
  /** Bottom sheet backdrop. */
  backdrop: 'rgba(31, 41, 40, 0.4)',
  /** Soft shadow of the fixed bottom bar and the sheets (2.4 §4). */
  shadow: '#1F2928',
} as const;

/** Status tags (2.4 §2.2): the text always says the status; color only reinforces it. */
export const statusColors = {
  paid: { text: '#24694B', background: '#E3F1EA' },
  pending: { text: '#7A5200', background: '#FCEFD2' },
  overdue: { text: '#A1281F', background: '#FBE4E1' },
  surcharge: { text: '#FFFFFF', background: '#A1281F' },
  advance: { text: '#4A6762', background: '#E4ECEA' },
  cancelled: { text: '#55605E', background: '#ECECEC' },
} as const;

export type StatusTone = keyof typeof statusColors;
