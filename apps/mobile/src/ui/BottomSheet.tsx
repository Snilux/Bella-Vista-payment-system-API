import type { ReactNode } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText } from './AppText.js';
import { colors, layout, radii, softShadow, spacing } from './theme/index.js';

// Hoja inferior (2.4 §6.3 and §6.7): selectors and confirmations open here, never in small
// dropdown menus. Built on React Native's Modal (no gesture library).

export type BottomSheetProps = {
  visible: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  /** Fixed buttons under the content. */
  footer?: ReactNode;
};

export function BottomSheet({ visible, onClose, title, children, footer }: BottomSheetProps) {
  const insets = useSafeAreaInsets();
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.root}>
        <Pressable
          style={styles.backdrop}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Cerrar"
        />
        <View
          style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.lg) }]}
          accessibilityViewIsModal
        >
          <View style={styles.handle} />
          <AppText variant="heading" accessibilityRole="header" style={styles.title}>
            {title}
          </AppText>
          <ScrollView style={styles.content} contentContainerStyle={styles.contentInner}>
            {children}
          </ScrollView>
          {footer ? <View style={styles.footer}>{footer}</View> : null}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: colors.backdrop },
  sheet: {
    ...softShadow,
    maxHeight: '85%',
    backgroundColor: colors.surface,
    borderTopLeftRadius: radii.sheet,
    borderTopRightRadius: radii.sheet,
    paddingTop: spacing.sm,
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.divider,
    marginBottom: spacing.md,
  },
  title: { paddingHorizontal: layout.screenMargin, marginBottom: spacing.sm },
  content: { flexGrow: 0 },
  contentInner: { paddingHorizontal: layout.screenMargin, paddingBottom: spacing.lg },
  footer: { paddingHorizontal: layout.screenMargin, gap: spacing.md },
});
