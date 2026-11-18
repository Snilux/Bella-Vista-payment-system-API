import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { OfflineNotice } from './OfflineNotice.js';
import { borders, colors, layout, radii, spacing } from './theme/index.js';

// Screen frame (2.4 §4; Figma C-01, C-02): safe area, scrolling content with the screen margin,
// the "Sin conexión" notice on top and, when given, a fixed bottom bar (top hairline) with
// the main button and its caption. The content scrolls under the keyboard, so at 140 % text
// every field stays reachable.

export type ScreenLayoutProps = {
  children: ReactNode;
  /** Fixed bottom bar: the main action and, below it, its caption. */
  footer?: ReactNode;
  /** Inside the tabs the bottom safe area belongs to the tab bar. */
  withinTabs?: boolean;
  /**
   * False for a screen whose body is a PaginatedList (a FlatList cannot live inside the
   * ScrollView): the list scrolls by itself and carries the header and the screen margin.
   */
  scroll?: boolean;
};

export function ScreenLayout({
  children,
  footer,
  withinTabs = false,
  scroll = true,
}: ScreenLayoutProps) {
  return (
    <SafeAreaView
      style={styles.safe}
      edges={withinTabs || footer ? ['top', 'left', 'right'] : ['top', 'left', 'right', 'bottom']}
    >
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {scroll ? (
          <ScrollView
            style={styles.flex}
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
          >
            <OfflineNotice />
            {children}
          </ScrollView>
        ) : (
          <View style={styles.listBody}>
            <View style={styles.listNotice}>
              <OfflineNotice />
            </View>
            {children}
          </View>
        )}
        {footer ? (
          <SafeAreaView edges={withinTabs ? [] : ['bottom']} style={styles.footer}>
            {footer}
          </SafeAreaView>
        ) : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/** A white card that groups menu rows (Figma C-04, C-05). */
export function MenuGroup({ children }: { children: ReactNode }) {
  return <View style={styles.group}>{children}</View>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  listBody: { flex: 1, paddingTop: spacing.xxl },
  listNotice: { paddingHorizontal: layout.screenMargin },
  content: {
    padding: layout.screenMargin,
    paddingTop: spacing.xxl,
    gap: layout.fieldGap,
    flexGrow: 1,
  },
  footer: {
    backgroundColor: colors.background,
    borderTopWidth: borders.hairline,
    borderTopColor: colors.divider,
    paddingHorizontal: layout.screenMargin,
    paddingTop: spacing.lg,
    paddingBottom: spacing.lg,
    gap: spacing.md,
  },
  group: {
    backgroundColor: colors.surface,
    borderWidth: borders.hairline,
    borderColor: colors.divider,
    borderRadius: radii.card,
    paddingHorizontal: spacing.lg,
    overflow: 'hidden',
  },
});
