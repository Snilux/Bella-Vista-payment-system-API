import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { refreshShownQueries } from './query-client.js';

/**
 * "Tirar para recargar" on screens that are not a list (homes, Mi caja, details; 3.2 §11.2):
 * reloads everything the mounted screens show and says when it is done.
 */
export function useRefresh() {
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void refreshShownQueries(queryClient, { staleOnly: false }).finally(() => setRefreshing(false));
  }, [queryClient]);
  return { refreshing, onRefresh };
}
