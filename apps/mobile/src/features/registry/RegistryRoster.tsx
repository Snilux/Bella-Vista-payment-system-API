import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useBlocks } from '../../api/useOrganization.js';
import { useBlockRoster } from '../../api/useRegistry.js';
import { useCan } from '../../session/permissions.js';
import { useAccount } from '../../session/session-store.js';
import {
  Button,
  Chip,
  colors,
  Header,
  ListRow,
  layout,
  ScreenLayout,
  ScreenState,
  SearchField,
  Select,
  screenStatusOf,
  spacing,
} from '../../ui/index.js';
import { openUnit } from './navigation.js';
import { filterRoster, ROSTER_FILTERS, type RosterFilter, rosterRows } from './registry-view.js';

// P-01 · Lista del padrón (Figma P-01; 3.2 §10.4). There is no list of families in the API: the
// roster is the block report (GET /v1/reports/block), every connection with its families, status
// and debt, not paginated (approved difference, 3.2 §6 M5). The block leader sees their block;
// the committee chooses one. The chips and the search box filter the loaded rows on the phone;
// "Buscar en todo el padrón" opens G-01. The Padrón tabs and the "Más" option render this.

export function RegistryRoster({ withinTabs = false }: { withinTabs?: boolean }) {
  const account = useAccount();
  const ownBlock = account?.blockId ?? null;
  const blocks = useBlocks();
  const canRegister = useCan('registry.manage');
  const [chosenBlock, setChosenBlock] = useState<number | null>(null);
  const [filter, setFilter] = useState<RosterFilter>('all');
  const [text, setText] = useState('');

  const activeBlocks = (blocks.data ?? []).filter((block) => block.active);
  const blockId = ownBlock ?? chosenBlock ?? activeBlocks[0]?.id ?? null;
  const roster = useBlockRoster(blockId);
  const rows = useMemo(() => (roster.data ? rosterRows(roster.data) : []), [roster.data]);
  const visible = filterRoster(rows, filter, text);

  // The report's block code is already the visible one (S1-M03).
  const blockCode = roster.data?.block.code ?? account?.blockCode ?? null;
  const subtitle = [
    blockCode ? `Manzana ${blockCode}` : null,
    roster.data ? (rows.length === 1 ? '1 familia' : `${rows.length} familias`) : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const status = blockId === null && blocks.isSuccess ? 'empty' : screenStatusOf(roster);

  const header = (
    <View style={styles.header}>
      <Header
        title="Padrón"
        {...(subtitle ? { subtitle } : {})}
        {...(withinTabs ? {} : { onBack: () => router.back() })}
      />
      {ownBlock === null && activeBlocks.length > 1 ? (
        <Select
          label="Manzana"
          options={activeBlocks.map((block) => ({ value: block.id, label: block.fullCode }))}
          value={blockId}
          onChange={setChosenBlock}
        />
      ) : null}
      <SearchField value={text} onChangeText={setText} placeholder="Buscar nombre, calle o folio" />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chips}
      >
        {ROSTER_FILTERS.map((option) => (
          <Chip
            key={option.value}
            label={option.label}
            selected={filter === option.value}
            onPress={() => setFilter(option.value)}
          />
        ))}
      </ScrollView>
      <Button
        label="Buscar en todo el padrón"
        variant="text"
        onPress={() =>
          router.push({ pathname: '/common/search', params: text.trim() ? { q: text.trim() } : {} })
        }
      />
    </View>
  );

  return (
    <ScreenLayout
      withinTabs={withinTabs}
      scroll={false}
      {...(canRegister
        ? {
            footer: (
              <Button
                label="Registrar persona"
                variant="secondary"
                onPress={() => router.push('/common/registry/new-person')}
              />
            ),
          }
        : {})}
    >
      {status !== 'ready' ? (
        <View style={styles.pad}>
          {header}
          <ScreenState
            status={status}
            error={roster.error}
            onRetry={() => void roster.refetch()}
            empty={{ message: 'Todavía no hay manzanas registradas.', icon: 'organization' }}
          />
        </View>
      ) : (
        <FlatList
          data={visible}
          keyExtractor={(row) => String(row.unitId)}
          ListHeaderComponent={header}
          renderItem={({ item }) => (
            <ListRow
              title={item.title}
              subtitle={item.subtitle}
              tag={item.tag}
              onPress={() => openUnit(item.unitId)}
            />
          )}
          ListEmptyComponent={
            <ScreenState
              status="empty"
              empty={
                rows.length === 0
                  ? {
                      message: 'Esta manzana todavía no tiene familias.',
                      icon: 'people',
                      ...(canRegister
                        ? {
                            action: {
                              label: 'Registrar persona',
                              onPress: () => router.push('/common/registry/new-person'),
                            },
                          }
                        : {}),
                    }
                  : {
                      message: 'Ninguna familia coincide con la búsqueda o el filtro.',
                      icon: 'search',
                      action: {
                        label: 'Ver todas',
                        onPress: () => {
                          setFilter('all');
                          setText('');
                        },
                      },
                    }
              }
            />
          }
          refreshControl={
            <RefreshControl
              refreshing={roster.isRefetching}
              onRefresh={() => void roster.refetch()}
              colors={[colors.primaryStrong]}
              tintColor={colors.primaryStrong}
            />
          }
          contentContainerStyle={styles.content}
        />
      )}
    </ScreenLayout>
  );
}

const styles = StyleSheet.create({
  header: { gap: spacing.md, paddingBottom: spacing.md },
  chips: { gap: spacing.sm },
  pad: { paddingHorizontal: layout.screenMargin, flex: 1 },
  content: { flexGrow: 1, paddingHorizontal: layout.screenMargin, paddingBottom: spacing.xl },
});
