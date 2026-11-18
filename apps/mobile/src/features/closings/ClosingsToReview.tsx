import type { Closing } from '@bella-vista/shared';
import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useClosings } from '../../api/useClosings.js';
import { useCan } from '../../session/permissions.js';
import {
  Chip,
  Header,
  RecordCard,
  ScreenLayout,
  ScreenState,
  screenStatusOf,
  spacing,
} from '../../ui/index.js';
import { cashboxTitle } from '../cashboxes/cashbox-view.js';
import { CLOSING_TAGS, closingTitle, differenceText } from './closing-view.js';

// R-04 · Cortes por revisar (the president's and the member's "Cortes" tab; 3.2 §10.8): the
// counted closings to review and, for the president, the reviewed ones to close. Each one opens
// G-08, where the action is.

type Filter = Extract<Closing['status'], 'counted' | 'reviewed'>;

export function ClosingsToReview() {
  const canClose = useCan('closings.close');
  const [filter, setFilter] = useState<Filter>('counted');
  const query = useClosings({ status: filter });
  return (
    <ScreenLayout withinTabs>
      <Header
        title={filter === 'counted' ? 'Cortes por revisar' : 'Cortes por cerrar'}
        subtitle={
          filter === 'counted'
            ? 'Contados por quien los preparó'
            : 'Revisados; al cerrarlos se bloquea el mes'
        }
      />
      {canClose ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chips}
        >
          <Chip
            label="Por revisar"
            selected={filter === 'counted'}
            onPress={() => setFilter('counted')}
          />
          <Chip
            label="Por cerrar"
            selected={filter === 'reviewed'}
            onPress={() => setFilter('reviewed')}
          />
        </ScrollView>
      ) : null}
      <ScreenState
        status={screenStatusOf(query, (data) => data.length === 0)}
        error={query.error}
        onRetry={() => void query.refetch()}
        empty={{
          message:
            filter === 'counted' ? 'No hay cortes por revisar.' : 'No hay cortes por cerrar.',
        }}
      >
        <View style={styles.list}>
          {(query.data ?? []).map((closing) => (
            <RecordCard
              key={closing.id}
              title={cashboxTitle(closing.cashbox)}
              details={[
                `${closingTitle(closing)} · preparó ${closing.preparedBy.fullName}`,
                differenceText(closing.difference),
              ]}
              tag={CLOSING_TAGS[closing.status]}
              onPress={() => router.push(`/common/closings/${closing.id}`)}
            />
          ))}
        </View>
      </ScreenState>
    </ScreenLayout>
  );
}

const styles = StyleSheet.create({
  chips: { gap: spacing.sm },
  list: { gap: spacing.md },
});
