import type { PersonBasic } from '@bella-vista/shared';
import { StyleSheet, View } from 'react-native';
import { describeError } from '../../api/error-messages.js';
import { usePersonSearch } from '../../api/usePersonSearch.js';
import {
  AppText,
  Button,
  colors,
  FieldMessage,
  ListRow,
  layout,
  radii,
  SearchField,
  spacing,
} from '../../ui/index.js';

// Buscador de persona (2.4 Buscador + Fila de lista): S-07 (new leader or officer), G-11
// (new holder) and later P-04 and P-05. The person is chosen from the registry; registering a
// new person is P-02 (M5). Homonyms are told apart by their distinguishing note and folio.

export type PersonPickerProps = {
  label: string;
  value: PersonBasic | null;
  onChange: (person: PersonBasic | null) => void;
  text: string;
  onChangeText: (text: string) => void;
  error?: string | null;
  /** People who cannot be chosen (e.g. the outgoing leader), with the reason. */
  exclude?: { ids: readonly number[]; reason: string };
};

export const personLine = (person: PersonBasic): string =>
  [person.fullName, person.distinguishingNote].filter(Boolean).join(' · ');

export function PersonPicker({
  label,
  value,
  onChange,
  text,
  onChangeText,
  error,
  exclude,
}: PersonPickerProps) {
  const search = usePersonSearch(value ? '' : text);

  if (value) {
    return (
      <View style={styles.container}>
        <AppText variant="label">{`${label} *`}</AppText>
        <View style={styles.chosen}>
          <AppText variant="bodyStrong">{personLine(value)}</AppText>
          <AppText variant="caption" color={colors.textSecondary}>
            {`Folio ${value.folio}`}
          </AppText>
        </View>
        <Button label="Cambiar persona" variant="text" onPress={() => onChange(null)} />
      </View>
    );
  }

  const people = search.data ?? [];
  return (
    <View style={styles.container}>
      <AppText variant="label">{`${label} *`}</AppText>
      <SearchField
        value={text}
        onChangeText={onChangeText}
        placeholder="Buscar por nombre o folio"
      />
      {error ? <FieldMessage error={error} /> : null}
      {search.tooShort ? (
        <AppText variant="caption" color={colors.textSecondary}>
          Escriba al menos 2 letras del nombre.
        </AppText>
      ) : search.isError ? (
        <FieldMessage error={describeError(search.error).message} />
      ) : search.isFetching && people.length === 0 ? (
        <AppText variant="caption" color={colors.textSecondary}>
          Buscando...
        </AppText>
      ) : search.isSuccess && people.length === 0 ? (
        <AppText variant="caption" color={colors.textSecondary}>
          {`Nadie coincide con «${search.searchedText}». Si es una persona nueva, regístrela primero en el padrón.`}
        </AppText>
      ) : (
        <View style={styles.results}>
          {people.map((person) => {
            const excluded = exclude?.ids.includes(person.id) ?? false;
            return (
              <ListRow
                key={person.id}
                title={personLine(person)}
                subtitle={excluded && exclude ? exclude.reason : `Folio ${person.folio}`}
                {...(excluded ? {} : { onPress: () => onChange(person) })}
              />
            );
          })}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: spacing.sm, alignSelf: 'stretch' },
  chosen: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    padding: layout.cardPadding,
    gap: spacing.xs,
  },
  results: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    overflow: 'hidden',
  },
});
