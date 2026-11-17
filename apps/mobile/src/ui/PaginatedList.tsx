import { type QueryKey, useInfiniteQuery } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { describeError } from '../api/error-messages.js';
import { AppText } from './AppText.js';
import { Button } from './Button.js';
import { type EmptyState, ScreenState, screenStatusOf } from './ScreenState.js';
import { colors, layout, spacing } from './theme/index.js';

// Lista paginada (3.2 §11.1): infinite query 20 by 20 over the API's keyset pagination
// (`?limit&cursor` → `{ data, next }`), pull to refresh and a "Cargando más..." footer.

export const PAGE_SIZE = 20;

export type Page<T> = { data: T[]; next: string | null };

export type FetchPage<T> = (params: {
  limit: number;
  cursor: string | undefined;
  signal: AbortSignal;
}) => Promise<Page<T>>;

export type PaginatedListProps<T> = {
  queryKey: QueryKey;
  fetchPage: FetchPage<T>;
  renderItem: (item: T) => ReactElement;
  keyExtractor: (item: T) => string;
  empty: EmptyState;
  /** Above the rows (filters, a summary card); scrolls with them. */
  header?: ReactElement;
  pageSize?: number;
};

export function PaginatedList<T>({
  queryKey,
  fetchPage,
  renderItem,
  keyExtractor,
  empty,
  header,
  pageSize = PAGE_SIZE,
}: PaginatedListProps<T>) {
  const query = useInfiniteQuery({
    queryKey,
    queryFn: ({ pageParam, signal }) =>
      fetchPage({ limit: pageSize, cursor: pageParam ?? undefined, signal }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next,
  });

  const items = query.data?.pages.flatMap((page) => page.data) ?? [];
  const status = screenStatusOf(query);

  if (status !== 'ready') {
    return (
      <View style={styles.fill}>
        {header}
        <ScreenState status={status} error={query.error} onRetry={() => query.refetch()} />
      </View>
    );
  }

  const loadMore = () => {
    if (query.hasNextPage && !query.isFetchingNextPage && !query.isFetchNextPageError) {
      void query.fetchNextPage();
    }
  };

  return (
    <FlatList
      data={items}
      keyExtractor={keyExtractor}
      renderItem={({ item }) => renderItem(item)}
      onEndReached={loadMore}
      onEndReachedThreshold={0.5}
      ListHeaderComponent={header}
      ListEmptyComponent={<ScreenState status="empty" empty={empty} />}
      ListFooterComponent={
        <Footer
          loading={query.isFetchingNextPage}
          error={query.isFetchNextPageError ? query.error : null}
          onRetry={() => void query.fetchNextPage()}
        />
      }
      refreshControl={
        <RefreshControl
          refreshing={query.isRefetching && !query.isFetchingNextPage}
          onRefresh={() => void query.refetch()}
          colors={[colors.primaryStrong]}
          tintColor={colors.primaryStrong}
        />
      }
      contentContainerStyle={styles.content}
    />
  );
}

function Footer({
  loading,
  error,
  onRetry,
}: {
  loading: boolean;
  error: unknown;
  onRetry: () => void;
}) {
  if (loading) {
    return (
      <View style={styles.footer}>
        <ActivityIndicator color={colors.primaryStrong} />
        <AppText variant="caption" color={colors.textSecondary}>
          Cargando más...
        </AppText>
      </View>
    );
  }
  if (error) {
    return (
      <View style={styles.footer}>
        <AppText variant="caption" color={colors.error} style={styles.centered}>
          {describeError(error).message}
        </AppText>
        <Button label="Reintentar" variant="text" onPress={onRetry} />
      </View>
    );
  }
  return null;
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { flexGrow: 1, paddingHorizontal: layout.screenMargin, paddingBottom: spacing.xl },
  footer: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.lg },
  centered: { textAlign: 'center' },
});
