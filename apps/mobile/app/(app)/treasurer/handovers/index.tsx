// T-02 · Entregas por confirmar
import type { Handover } from '@bella-vista/shared';
import { formatDate, formatMoney } from '@bella-vista/shared';
import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { handoverPages } from '../../../../src/api/useCashboxes.js';
import {
  cashboxTitle,
  HANDOVER_TAGS,
  handoverSummary,
} from '../../../../src/features/cashboxes/cashbox-view.js';
import {
  Chip,
  Header,
  PaginatedList,
  RecordCard,
  ScreenLayout,
  spacing,
} from '../../../../src/ui/index.js';

// The handovers the treasurer must count (Figma T-02; 3.2 §10.6; D-16): block and leader, folio,
// date and declared amount; each one opens T-03. "Con diferencia" lists the confirmed ones with a
// shortfall still to clarify (an adjustment the president authorizes, G-11).

type Filter = Extract<Handover['status'], 'pending' | 'with_difference'>;

export default function TreasurerHandovers() {
  const [filter, setFilter] = useState<Filter>('pending');
  const pages = handoverPages(filter);
  return (
    <ScreenLayout withinTabs scroll={false}>
      <PaginatedList
        queryKey={pages.queryKey}
        fetchPage={pages.fetchPage}
        keyExtractor={(item) => String(item.id)}
        header={
          <View style={styles.header}>
            <Header
              title={filter === 'pending' ? 'Entregas por confirmar' : 'Entregas con diferencia'}
              subtitle={
                filter === 'pending'
                  ? 'Cuente el dinero antes de confirmar'
                  : 'Faltantes por aclarar con el presidente'
              }
            />
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.chips}
            >
              <Chip
                label="Por confirmar"
                selected={filter === 'pending'}
                onPress={() => setFilter('pending')}
              />
              <Chip
                label="Con diferencia"
                selected={filter === 'with_difference'}
                onPress={() => setFilter('with_difference')}
              />
            </ScrollView>
          </View>
        }
        renderItem={(item) => (
          <RecordCard
            title={`${cashboxTitle(item.cashbox)} · ${item.preparedBy.fullName}`}
            details={[
              `${item.folio} · ${formatDate(item.date)}`,
              item.status === 'pending'
                ? `Declarado ${formatMoney(item.declaredAmount)}`
                : handoverSummary(item),
            ]}
            tag={HANDOVER_TAGS[item.status]}
            onPress={() => router.push(`/treasurer/handovers/${item.id}`)}
          />
        )}
        empty={
          filter === 'pending'
            ? { message: 'No hay entregas por confirmar.' }
            : { message: 'No hay faltantes por aclarar.' }
        }
      />
    </ScreenLayout>
  );
}

const styles = StyleSheet.create({
  header: { gap: spacing.md, paddingBottom: spacing.md },
  chips: { gap: spacing.sm },
});
