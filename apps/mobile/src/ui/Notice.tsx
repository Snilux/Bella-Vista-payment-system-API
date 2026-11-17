import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { AppText } from './AppText.js';
import { Icon, type IconName } from './Icon.js';
import { colors, radii, spacing } from './theme/index.js';

// Aviso en página (2.4 §6.7): a surface-warm strip with an icon and text (no connection, active
// surcharge, closed period). It stays on the page: no toasts that disappear on their own.

export type NoticeProps = {
  /** Main sentence; Body strong when there is a detail under it. */
  title: string;
  detail?: string;
  icon?: IconName;
  /** Optional action (a text Button) under the text. */
  action?: ReactNode;
};

export function Notice({ title, detail, icon = 'alert', action }: NoticeProps) {
  return (
    <View style={styles.notice} accessibilityRole="alert">
      <Icon name={icon} color={colors.text} />
      <View style={styles.body}>
        <AppText variant={detail ? 'bodyStrong' : 'body'}>{title}</AppText>
        {detail ? <AppText variant="body">{detail}</AppText> : null}
        {action}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  notice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radii.control,
    backgroundColor: colors.surfaceWarm,
  },
  body: { flex: 1, gap: spacing.xs },
});
