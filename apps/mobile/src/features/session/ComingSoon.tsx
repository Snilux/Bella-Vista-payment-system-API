import { StyleSheet, View } from 'react-native';
import { type ScreenId, screenById } from '../../session/screen-catalog.js';
import { AppText, colors, Header, Notice, ScreenLayout, spacing } from '../../ui/index.js';

// Provisional page of a screen that a later phase builds (3.2 §6): a tab or a "Más" option
// never opens a blank screen or an error. It says what the screen is and that it is on its way;
// the ID and phase help whoever tests the app to report it.

export type ComingSoonProps = {
  screen: ScreenId;
  /** Back button (pages opened from "Más"); tabs have none. */
  onBack?: () => void;
  withinTabs?: boolean;
};

export function ComingSoon({ screen, onBack, withinTabs = false }: ComingSoonProps) {
  const entry = screenById(screen);
  return (
    <ScreenLayout withinTabs={withinTabs}>
      <Header title={entry.title} {...(onBack ? { onBack } : {})} />
      <Notice
        icon="soon"
        title="Próximamente"
        detail="Esta pantalla todavía está en construcción. Mientras tanto, use las otras opciones del menú."
      />
      <View style={styles.reference}>
        <AppText variant="caption" color={colors.textSecondary}>
          {`Pantalla ${entry.id} · fase ${entry.phase}`}
        </AppText>
      </View>
    </ScreenLayout>
  );
}

const styles = StyleSheet.create({
  reference: { paddingTop: spacing.sm },
});
