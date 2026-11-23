import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import {
  Keyboard,
  type KeyboardEvent,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  type ScrollViewInstance,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText } from './AppText.js';
import { colors, layout, radii, softShadow, spacing } from './theme/index.js';

// Hoja inferior (2.4 §6.3 and §6.7): selectors and confirmations open here, never in small
// dropdown menus. Built on React Native's Modal (no gesture library).
//
// The keyboard: a Modal is its own window and, with statusBarTranslucent (edge to edge), Android
// does not resize it, so the keyboard would cover the fields. The sheet rises above the keyboard
// by the part of it that overlaps the sheet's window (zero where the system already resized
// it), its content scrolls in the space left and the field being typed in scrolls into view
// (iOS does not do it by itself).

export type BottomSheetProps = {
  visible: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  /** Fixed buttons under the content. */
  footer?: ReactNode;
};

/** The keyboard's top edge on screen (null while hidden). */
function useKeyboardTop(active: boolean): number | null {
  const [top, setTop] = useState<number | null>(null);
  useEffect(() => {
    if (!active) {
      setTop(null);
      return;
    }
    const ios = Platform.OS === 'ios';
    const show = Keyboard.addListener(
      ios ? 'keyboardWillChangeFrame' : 'keyboardDidShow',
      (event: KeyboardEvent) => setTop(event.endCoordinates.screenY),
    );
    const hide = Keyboard.addListener(ios ? 'keyboardWillHide' : 'keyboardDidHide', () =>
      setTop(null),
    );
    return () => {
      show.remove();
      hide.remove();
    };
  }, [active]);
  return top;
}

export function BottomSheet({ visible, onClose, title, children, footer }: BottomSheetProps) {
  const insets = useSafeAreaInsets();
  const keyboardTop = useKeyboardTop(visible);
  const [windowHeight, setWindowHeight] = useState<number | null>(null);
  const keyboardOverlap =
    keyboardTop !== null && windowHeight !== null ? Math.max(0, windowHeight - keyboardTop) : 0;
  const scrollRef = useRef<ScrollViewInstance>(null);
  const scrollY = useRef(0);

  /** Scrolls the content so the focused field is visible above the keyboard. */
  const revealFocusedField = useCallback(() => {
    const input = TextInput.State.currentlyFocusedInput();
    const scroll = scrollRef.current;
    if (!input || !scroll) return;
    scroll.measureInWindow((_sx, scrollTop, _sw, scrollHeight) => {
      input.measureInWindow((_ix, inputTop, _iw, inputHeight) => {
        const below = inputTop + inputHeight + spacing.md - (scrollTop + scrollHeight);
        const above = scrollTop - inputTop;
        if (below > 0) scroll.scrollTo({ y: scrollY.current + below, animated: true });
        else if (above > 0)
          scroll.scrollTo({ y: Math.max(0, scrollY.current - above - spacing.md), animated: true });
      });
    });
  }, []);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View
        testID="bottom-sheet-window"
        style={styles.root}
        onLayout={(event) => setWindowHeight(event.nativeEvent.layout.height)}
      >
        <Pressable
          style={styles.backdrop}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Cerrar"
        />
        <View
          testID="bottom-sheet-area"
          style={[styles.area, { marginBottom: keyboardOverlap }]}
          pointerEvents="box-none"
        >
          <View
            style={[
              styles.sheet,
              {
                // Over the keyboard the bottom safe area (home indicator) is hidden anyway.
                paddingBottom:
                  keyboardOverlap > 0 ? spacing.lg : Math.max(insets.bottom, spacing.lg),
              },
            ]}
            accessibilityViewIsModal
          >
            <View style={styles.handle} />
            <AppText variant="heading" accessibilityRole="header" style={styles.title}>
              {title}
            </AppText>
            <ScrollView
              ref={scrollRef}
              style={styles.content}
              contentContainerStyle={styles.contentInner}
              keyboardShouldPersistTaps="handled"
              scrollEventThrottle={16}
              onScroll={(event) => {
                scrollY.current = event.nativeEvent.contentOffset.y;
              }}
              // The content shrinks once the sheet rests over the keyboard: then reveal the field.
              onLayout={keyboardOverlap > 0 ? revealFocusedField : undefined}
            >
              {children}
            </ScrollView>
            {footer ? <View style={styles.footer}>{footer}</View> : null}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: colors.backdrop },
  /** Everything above the keyboard: the sheet sits at its bottom, at most 85 % of it. */
  area: { flex: 1, justifyContent: 'flex-end' },
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
  content: { flexGrow: 0, flexShrink: 1 },
  contentInner: { paddingHorizontal: layout.screenMargin, paddingBottom: spacing.lg },
  footer: { paddingHorizontal: layout.screenMargin, gap: spacing.md },
});
