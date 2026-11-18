// G-01 · Buscar
import { router, useLocalSearchParams } from 'expo-router';
import { type ReactNode, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { describeError } from '../../../src/api/error-messages.js';
import { useSearch } from '../../../src/api/usePersonSearch.js';
import { personLine } from '../../../src/features/people/PersonPicker.js';
import { openConnection, openPerson, openUnit } from '../../../src/features/registry/navigation.js';
import {
  CONNECTION_STATUS_LABELS,
  debtView,
  unitTag,
} from '../../../src/features/registry/registry-view.js';
import { useCan } from '../../../src/session/permissions.js';
import {
  AppText,
  Button,
  colors,
  Header,
  ListRow,
  MenuGroup,
  Notice,
  ScreenLayout,
  SearchField,
  spacing,
} from '../../../src/ui/index.js';

// Search of people, connections and families (3.2 §10.2; §11.2 "Búsquedas"): 400 ms after the
// last letter, at least 2 letters, without accents or case, the previous request cancelled. The
// API decides what arrives for each role (a block leader gets no connection or family of another
// block, and of a person outside their block only name, distinguishing note and folio): the
// screen shows what comes and assumes nothing more.

export default function Search() {
  const params = useLocalSearchParams<{ q?: string }>();
  const [text, setText] = useState(params.q ?? '');
  const search = useSearch(text);
  const canRegister = useCan('registry.manage');
  const data = search.data;
  const nothing = data && data.people.length + data.connections.length + data.units.length === 0;

  return (
    <ScreenLayout>
      <Header title="Buscar" onBack={() => router.back()} />
      <SearchField
        value={text}
        onChangeText={setText}
        placeholder="Buscar nombre, calle o folio"
        autoFocus
      />

      {search.tooShort ? (
        <AppText variant="caption" color={colors.textSecondary}>
          Escriba al menos 2 letras. No importan los acentos ni las mayúsculas.
        </AppText>
      ) : search.isError ? (
        <Notice
          title={describeError(search.error).message}
          action={
            <Button label="Reintentar" variant="secondary" onPress={() => void search.refetch()} />
          }
        />
      ) : !data ? (
        <AppText variant="caption" color={colors.textSecondary}>
          Buscando...
        </AppText>
      ) : nothing ? (
        <Notice
          icon="info"
          title={`Nadie coincide con «${search.searchedText}».`}
          detail="Revise cómo se escribe, o búsquelo por calle o por folio."
          {...(canRegister
            ? {
                action: (
                  <Button
                    label="Registrar persona"
                    variant="secondary"
                    onPress={() => router.push('/common/registry/new-person')}
                  />
                ),
              }
            : {})}
        />
      ) : (
        <View style={styles.groups}>
          {data.people.length > 0 ? (
            <Group title="Personas">
              {data.people.map((person) => (
                <ListRow
                  key={`p${person.id}`}
                  title={personLine(person)}
                  subtitle={`Folio ${person.folio}`}
                  onPress={() => openPerson(person.id)}
                />
              ))}
            </Group>
          ) : null}
          {data.connections.length > 0 ? (
            <Group title="Tomas">
              {data.connections.map((connection) => (
                <ListRow
                  key={`c${connection.id}`}
                  title={`Toma ${connection.folio} · ${connection.address}`}
                  subtitle={[
                    connection.blockCode,
                    CONNECTION_STATUS_LABELS[connection.status],
                    connection.unitCount === 1 ? '1 familia' : `${connection.unitCount} familias`,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                  onPress={() => openConnection(connection.id)}
                />
              ))}
            </Group>
          ) : null}
          {data.units.length > 0 ? (
            <Group title="Familias">
              {data.units.map((unit) => (
                <ListRow
                  key={`u${unit.id}`}
                  title={`Familia ${unit.folio}${unit.holder ? ` · ${personLine(unit.holder)}` : ''}`}
                  subtitle={[
                    unit.address,
                    `Toma ${unit.connectionFolio}`,
                    debtView(unit.debt).text,
                  ].join(' · ')}
                  tag={unitTag(unit.status, unit.debt)}
                  onPress={() => openUnit(unit.id)}
                />
              ))}
            </Group>
          ) : null}
        </View>
      )}
    </ScreenLayout>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.group}>
      <AppText variant="heading">{title}</AppText>
      <MenuGroup>{children}</MenuGroup>
    </View>
  );
}

const styles = StyleSheet.create({
  groups: { gap: spacing.lg },
  group: { gap: spacing.md },
});
