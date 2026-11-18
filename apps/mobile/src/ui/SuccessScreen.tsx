import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { AppText } from './AppText.js';
import { Button } from './Button.js';
import { Icon } from './Icon.js';
import { colors, iconSizes, layout, spacing } from './theme/index.js';

// Pantalla de éxito (2.4 §6.7; wireframe F-04): full screen with a green 72 checkmark-circle,
// the title, the key data (DataRow) and "Listo". Used by payments, handovers, expenses and
// requests sent to the president.

export type SuccessScreenProps = {
  title: string;
  /** A sentence over the data (e.g. "Copie estos datos en el recibo:"). */
  message?: string;
  children?: ReactNode;
  onDone: () => void;
  doneLabel?: string;
  /** Optional second action (e.g. "Cobrar a otra familia"). */
  secondary?: { label: string; onPress: () => void };
  /** A text button under the data (e.g. "Ver el pago"). */
  link?: { label: string; onPress: () => void };
};

export function SuccessScreen({
  title,
  message,
  children,
  onDone,
  doneLabel = 'Listo',
  secondary,
  link,
}: SuccessScreenProps) {
  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.hero} accessibilityLiveRegion="polite">
          <Icon name="success" size={iconSizes.success} color={colors.success} />
          <AppText variant="title" accessibilityRole="header" style={styles.centered}>
            {title}
          </AppText>
        </View>
        {message ? <AppText variant="body">{message}</AppText> : null}
        {children ? <View style={styles.data}>{children}</View> : null}
        {link ? <Button label={link.label} variant="text" onPress={link.onPress} /> : null}
      </ScrollView>
      <View style={styles.actions}>
        <Button label={doneLabel} onPress={onDone} />
        {secondary ? (
          <Button label={secondary.label} variant="secondary" onPress={secondary.onPress} />
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    gap: spacing.xl,
    padding: layout.screenMargin,
  },
  hero: { alignItems: 'center', gap: spacing.lg },
  centered: { textAlign: 'center' },
  data: { gap: spacing.md },
  actions: { gap: spacing.md, padding: layout.screenMargin },
});
