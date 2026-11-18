import type { PersonBasic } from '@bella-vista/shared';
import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { describeError } from '../../api/error-messages.js';
import { useSearch } from '../../api/usePersonSearch.js';
import { usePerson } from '../../api/useRegistry.js';
import {
  AppText,
  BottomSheet,
  Button,
  colors,
  Header,
  Notice,
  RecordCard,
  ScreenLayout,
  SearchField,
  spacing,
} from '../../ui/index.js';
import { personLine } from '../people/PersonPicker.js';
import { debtView, unitTag } from '../registry/registry-view.js';

// F-01 · Buscar familia (Figma F-01; 3.2 §10.3): the family to collect from, by name, street or
// folio (400 ms, 2 letters, the previous request cancelled). A family opens F-02; a person opens
// their families (when there is only one, F-02 at once). The API only returns what the role may
// see: a block leader finds the families of their block. The Cobrar tabs render this.

export const openMonths = (unitId: number) =>
  router.push({ pathname: '/common/new-payment/months', params: { unitId: String(unitId) } });

export function FamilySearch({ withinTabs = false }: { withinTabs?: boolean }) {
  const [text, setText] = useState('');
  const [person, setPerson] = useState<PersonBasic | null>(null);
  const search = useSearch(text);
  const data = search.data;
  const nothing = data && data.units.length === 0 && data.people.length === 0;

  return (
    <ScreenLayout withinTabs={withinTabs}>
      <Header
        title="Registrar pago"
        step={{ current: 1, total: 4 }}
        {...(withinTabs ? {} : { onBack: () => router.back() })}
      />
      <SearchField value={text} onChangeText={setText} placeholder="Buscar nombre, calle o folio" />

      {search.tooShort ? (
        <AppText variant="caption" color={colors.textSecondary}>
          Escriba al menos 2 letras del titular, la calle o el folio de la familia.
        </AppText>
      ) : search.isError ? (
        <Notice title={describeError(search.error).message} />
      ) : !data ? (
        <AppText variant="caption" color={colors.textSecondary}>
          Buscando...
        </AppText>
      ) : nothing ? (
        <Notice icon="info" title={`Nadie coincide con «${search.searchedText}».`} />
      ) : (
        <View style={styles.list}>
          <AppText variant="heading">Resultados</AppText>
          {data.units.map((unit) => {
            const debt = debtView(unit.debt);
            return (
              <RecordCard
                key={`u${unit.id}`}
                title={unit.holder ? personLine(unit.holder) : `Familia ${unit.folio}`}
                details={[`${unit.address} · Toma ${unit.connectionFolio} · ${unit.folio}`]}
                summary={debt.text}
                tag={unitTag(unit.status, unit.debt)}
                accessibilityHint="Abre los meses por cobrar"
                onPress={() => openMonths(unit.id)}
              />
            );
          })}
          {data.people.map((found) => (
            <RecordCard
              key={`p${found.id}`}
              title={personLine(found)}
              details={[`Folio ${found.folio}`]}
              accessibilityHint="Muestra sus familias"
              onPress={() => setPerson(found)}
            />
          ))}
        </View>
      )}

      {person ? <PersonFamilies person={person} onClose={() => setPerson(null)} /> : null}
    </ScreenLayout>
  );
}

/** The families of a person the role may collect from; one family goes straight to F-02. */
function PersonFamilies({ person, onClose }: { person: PersonBasic; onClose: () => void }) {
  const query = usePerson(person.id);
  const detail = query.data;
  const own =
    detail?.access === 'full'
      ? detail.units.flatMap((unit) => (unit.scope === 'own' ? [unit] : []))
      : [];
  return (
    <BottomSheet
      visible
      title={personLine(person)}
      onClose={onClose}
      footer={<Button label="Volver" variant="secondary" onPress={onClose} />}
    >
      {query.isPending ? (
        <AppText variant="caption">Buscando sus familias...</AppText>
      ) : own.length === 0 ? (
        <Notice icon="info" title="Esta persona no tiene familias en las que usted pueda cobrar." />
      ) : (
        <View style={styles.list}>
          {own.map((unit) => (
            <RecordCard
              key={unit.id}
              title={`Familia ${unit.folio}`}
              details={[`${unit.address} · Toma ${unit.connectionFolio}`]}
              summary={debtView(unit.debt).text}
              tag={unitTag(unit.status, unit.debt)}
              onPress={() => {
                onClose();
                openMonths(unit.id);
              }}
            />
          ))}
        </View>
      )}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({ list: { gap: spacing.md } });
