// G-02 · Ficha de persona
import { formatDate, formatMoney } from '@bella-vista/shared';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { usePerson } from '../../../../src/api/useRegistry.js';
import { openUnit, personParams } from '../../../../src/features/registry/navigation.js';
import { debtView, unitTag } from '../../../../src/features/registry/registry-view.js';
import { useCan } from '../../../../src/session/permissions.js';
import {
  AppText,
  BottomSheet,
  Button,
  DataRow,
  Header,
  MenuGroup,
  MenuRow,
  Notice,
  RecordCard,
  ScreenLayout,
  ScreenState,
  SummaryCard,
  screenStatusOf,
  spacing,
} from '../../../../src/ui/index.js';

// A person with their families and connection requests (Figma G-02; 3.2 §10.2). The API decides
// what arrives: with access "basic" (a person outside the block leader's scope) only name,
// distinguishing note and folio; a family of another block comes as "other_block", without
// folio, address or amounts. The screen draws only that. "Agregar familia o toma" offers only
// what the role may do (registry.manage → P-03, connectionRequests.manage → P-05).

export default function PersonFile() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const query = usePerson(Number(id));
  const canPreexisting = useCan('registry.manage');
  const canRequest = useCan('connectionRequests.manage');
  const [adding, setAdding] = useState(false);
  const status = screenStatusOf(query);
  const person = query.data;

  if (status !== 'ready' || !person) {
    return (
      <ScreenLayout>
        <Header title="Ficha de persona" onBack={() => router.back()} />
        <ScreenState status={status} error={query.error} onRetry={() => void query.refetch()} />
      </ScreenLayout>
    );
  }

  const subtitle = [
    `Folio ${person.folio}`,
    person.distinguishingNote ? `Distintivo ${person.distinguishingNote}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  if (person.access === 'basic') {
    return (
      <ScreenLayout>
        <Header title={person.fullName} subtitle={subtitle} onBack={() => router.back()} />
        <Notice
          icon="lock"
          title="Esta persona no tiene familias ni solicitudes en su manzana."
          detail="Solo puede ver su nombre, su distintivo y su folio."
        />
      </ScreenLayout>
    );
  }

  const ownUnits = person.units.flatMap((unit) => (unit.scope === 'own' ? [unit] : []));
  const otherBlock = person.units.length - ownUnits.length;

  const options = [
    canPreexisting
      ? {
          label: 'Toma que ya existía',
          pathname: '/common/registry/pre-existing-connection' as const,
        }
      : null,
    canRequest
      ? {
          label: 'Nueva solicitud de toma',
          pathname: '/common/registry/new-connection-request' as const,
        }
      : null,
  ].filter((option) => option !== null);

  return (
    <ScreenLayout
      {...(options.length > 0
        ? {
            footer: (
              <Button
                label="Agregar familia o toma"
                variant="secondary"
                onPress={() => setAdding(true)}
              />
            ),
          }
        : {})}
    >
      <Header title={person.fullName} subtitle={subtitle} onBack={() => router.back()} />

      <SummaryCard tone="plain">
        {person.phone ? <DataRow label="Teléfono" value={person.phone} /> : null}
        <DataRow label="Registrado" value={formatDate(person.registeredOn)} />
        {person.totalDue > 0 ? (
          <DataRow label="Debe en total" value={formatMoney(person.totalDue)} amount />
        ) : null}
      </SummaryCard>

      <AppText variant="heading">Familias</AppText>
      {person.units.length === 0 ? (
        <AppText variant="body">Todavía no es titular de ninguna familia.</AppText>
      ) : (
        <View style={styles.list}>
          {ownUnits.map((unit) => (
            <RecordCard
              key={unit.id}
              title={`Familia ${unit.folio}`}
              details={[
                [unit.address, `Toma ${unit.connectionFolio}`, unit.blockCode]
                  .filter(Boolean)
                  .join(' · '),
              ]}
              summary={debtView(unit.debt).text}
              tag={unitTag(unit.status, unit.debt)}
              onPress={() => openUnit(unit.id)}
            />
          ))}
          {otherBlock > 0 ? (
            // Families of other blocks come without folio, address or amounts (RF-PAD-04).
            <RecordCard
              title={
                otherBlock === 1
                  ? 'Familia de otra manzana'
                  : `${otherBlock} familias de otra manzana`
              }
              details={['Sin acceso a sus pagos']}
            />
          ) : null}
        </View>
      )}

      {person.connectionRequests.length > 0 ? (
        <>
          <AppText variant="heading">Solicitudes de toma</AppText>
          <MenuGroup>
            {person.connectionRequests.map((request) => (
              <MenuRow
                key={request.id}
                label={[request.folio, request.address, request.blockCode]
                  .filter(Boolean)
                  .join(' · ')}
                icon="connection"
                onPress={() =>
                  router.push({
                    pathname: '/common/connection-requests/[id]/activate',
                    params: { id: String(request.id) },
                  })
                }
              />
            ))}
          </MenuGroup>
        </>
      ) : null}

      {adding ? (
        <BottomSheet visible title="Agregar familia o toma" onClose={() => setAdding(false)}>
          <MenuGroup>
            {options.map((option) => (
              <MenuRow
                key={option.pathname}
                label={option.label}
                icon="connection"
                onPress={() => {
                  setAdding(false);
                  router.push({ pathname: option.pathname, params: personParams(person) });
                }}
              />
            ))}
          </MenuGroup>
          <AppText variant="caption">
            Para agregar una familia a una toma que ya está en el padrón, ábrala desde «Buscar».
          </AppText>
        </BottomSheet>
      ) : null}
    </ScreenLayout>
  );
}

const styles = StyleSheet.create({ list: { gap: spacing.md } });
