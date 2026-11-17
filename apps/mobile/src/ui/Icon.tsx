import Ionicons from '@expo/vector-icons/Ionicons';
import { colors, iconSizes } from './theme/index.js';

/**
 * Outline Ionicons of 2.4 §5 (the 18 of the Figma "Iconos" page plus the feedback ones).
 * Icons always go with a text, so they are hidden from screen readers.
 */
export const ICONS = {
  home: 'home-outline',
  cash: 'cash-outline',
  people: 'people-outline',
  wallet: 'wallet-outline',
  menu: 'menu-outline',
  handover: 'swap-horizontal-outline',
  report: 'document-text-outline',
  closing: 'clipboard-outline',
  approvals: 'checkmark-done-outline',
  organization: 'business-outline',
  connection: 'water-outline',
  forward: 'chevron-forward',
  back: 'chevron-back',
  down: 'chevron-down',
  search: 'search-outline',
  check: 'checkmark',
  alert: 'alert-circle-outline',
  success: 'checkmark-circle',
  successOutline: 'checkmark-circle-outline',
  download: 'download-outline',
  offline: 'cloud-offline-outline',
  lock: 'lock-closed-outline',
  info: 'information-circle-outline',
  close: 'close',
} as const satisfies Record<string, keyof typeof Ionicons.glyphMap>;

export type IconName = keyof typeof ICONS;

export type IconProps = {
  name: IconName;
  size?: number;
  color?: string;
};

export function Icon({ name, size = iconSizes.list, color = colors.textSecondary }: IconProps) {
  return (
    <Ionicons
      name={ICONS[name]}
      size={size}
      color={color}
      accessible={false}
      importantForAccessibility="no"
    />
  );
}
