import { memo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { AppText } from './AppText.js';
import { Icon } from './Icon.js';
import { StatusTag } from './StatusTag.js';
import { borders, colors, layout, radii, type StatusTone, spacing } from './theme/index.js';

// Tarjeta de registro (2.4 §6.5; Figma "Tarjeta de registro"): white card with a divider border,
// name in Body strong, data in Caption, a summary line with its status tag and a chevron when
// it opens something. Figma puts the tag next to the summary line (2.4 said top right; the
// look follows Figma, 3.2 §9.1).

export type RecordCardProps = {
  title: string;
  /** Data lines in Caption (address, folio...). */
  details?: readonly string[];
  /** Summary in Body (e.g. "Debe $400.00", "Al corriente"). */
  summary?: string;
  tag?: { tone: StatusTone; label?: string };
  onPress?: () => void;
  accessibilityHint?: string;
};

export const RecordCard = memo(function RecordCard({
  title,
  details = [],
  summary,
  tag,
  onPress,
  accessibilityHint,
}: RecordCardProps) {
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityHint={accessibilityHint}
      style={({ pressed }) => [styles.card, pressed && onPress ? styles.pressed : null]}
    >
      <View style={styles.main}>
        <AppText variant="bodyStrong">{title}</AppText>
        {details.map((line) => (
          <AppText key={line} variant="caption" color={colors.textSecondary}>
            {line}
          </AppText>
        ))}
        {summary || tag ? (
          <View style={styles.summary}>
            {summary ? (
              <AppText variant="body" amount>
                {summary}
              </AppText>
            ) : null}
            {tag ? (
              <StatusTag tone={tag.tone} {...(tag.label ? { label: tag.label } : {})} />
            ) : null}
          </View>
        ) : null}
      </View>
      {onPress ? <Icon name="forward" /> : null}
    </Pressable>
  );
});

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: layout.touchTarget,
    padding: spacing.lg,
    backgroundColor: colors.surface,
    borderWidth: borders.hairline,
    borderColor: colors.divider,
    borderRadius: radii.card,
  },
  pressed: { backgroundColor: colors.primarySoft },
  main: { flex: 1, gap: spacing.xs },
  summary: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.md,
    marginTop: spacing.xs,
  },
});
