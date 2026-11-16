import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText } from './AppText.js';
import { Icon, type IconName } from './Icon.js';
import {
  borders,
  colors,
  iconSizes,
  layout,
  radii,
  softShadow,
  spacing,
  statusColors,
} from './theme/index.js';

// Barra de pestañas (2.4 §6.6; Figma "Pestaña"): always visible, 3 to 5 tabs by role, 72 high,
// icon 26 and Label text; the active tab is primary-strong with a 3-point top indicator.
// M2 plugs it into Expo Router's Tabs (tabBar prop) with the tabs of each role.

export type TabItem = {
  key: string;
  label: string;
  icon: IconName;
  /** Pending count (e.g. authorizations of the president). */
  badge?: number;
};

export type TabBarProps = {
  items: readonly TabItem[];
  activeKey: string;
  onSelect: (key: string) => void;
};

export function TabBar({ items, activeKey, onSelect }: TabBarProps) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.bar, { paddingBottom: insets.bottom }]} accessibilityRole="tablist">
      {items.map((item) => (
        <Tab
          key={item.key}
          item={item}
          active={item.key === activeKey}
          onPress={() => onSelect(item.key)}
        />
      ))}
    </View>
  );
}

function Tab({ item, active, onPress }: { item: TabItem; active: boolean; onPress: () => void }) {
  const color = active ? colors.primaryStrong : colors.textSecondary;
  const badge = item.badge && item.badge > 0 ? item.badge : null;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="tab"
      accessibilityLabel={badge ? `${item.label}, ${badge} pendientes` : item.label}
      accessibilityState={{ selected: active }}
      style={styles.tab}
    >
      <View style={[styles.indicator, active && styles.indicatorActive]} />
      <View>
        <Icon name={item.icon} size={iconSizes.tab} color={color} />
        {badge ? (
          <View style={styles.badge}>
            <AppText variant="captionStrong" color={statusColors.surcharge.text}>
              {badge > 99 ? '99+' : String(badge)}
            </AppText>
          </View>
        ) : null}
      </View>
      <AppText variant="label" color={color} style={styles.label}>
        {item.label}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: {
    ...softShadow,
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderTopWidth: borders.hairline,
    borderTopColor: colors.divider,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: spacing.xs,
    minHeight: layout.tabBarHeight,
    paddingBottom: spacing.sm,
  },
  indicator: {
    alignSelf: 'center',
    width: 32,
    height: layout.tabIndicator,
    borderRadius: layout.tabIndicator,
    marginBottom: spacing.sm,
    backgroundColor: 'transparent',
  },
  indicatorActive: { backgroundColor: colors.primaryStrong },
  label: { textAlign: 'center' },
  badge: {
    position: 'absolute',
    top: -6,
    right: -14,
    minWidth: 22,
    paddingHorizontal: spacing.xs,
    borderRadius: radii.pill,
    alignItems: 'center',
    backgroundColor: statusColors.surcharge.background,
  },
});
