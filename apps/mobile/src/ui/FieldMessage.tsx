import { StyleSheet, View } from 'react-native';
import { AppText } from './AppText.js';
import { Icon } from './Icon.js';
import { colors, spacing } from './theme/index.js';

/** Under a field: the error (alert icon + Caption in red) or else the help (2.4 §6.2). */
export function FieldMessage({ error, help }: { error?: string | null; help?: string | null }) {
  if (error) {
    return (
      <View style={styles.row} accessibilityLiveRegion="polite">
        <Icon name="alert" size={20} color={colors.error} />
        <AppText variant="caption" color={colors.error} style={styles.text}>
          {error}
        </AppText>
      </View>
    );
  }
  if (help) {
    return (
      <AppText variant="caption" color={colors.textSecondary}>
        {help}
      </AppText>
    );
  }
  return null;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.xs },
  text: { flex: 1 },
});
