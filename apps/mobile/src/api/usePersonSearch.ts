import { searchResponseSchema } from '@bella-vista/shared';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { requireApiClient } from './api.js';
import { queryKeys } from './keys.js';

// Person search of the pickers (3.2 §11.2 "Búsquedas"): waits 400 ms after the last letter,
// needs 2 letters and cancels the previous request (TanStack Query aborts the old key's signal).
// The API decides what each role receives of each person.

export const SEARCH_DELAY_MS = 400;
export const SEARCH_MIN_LENGTH = 2;

export function useDebounced(value: string, delay = SEARCH_DELAY_MS): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

export function usePersonSearch(text: string) {
  const q = useDebounced(text.trim());
  const query = useQuery({
    queryKey: queryKeys.search(q),
    queryFn: ({ signal }) =>
      requireApiClient().request({
        method: 'GET',
        path: '/search',
        query: { q },
        schema: searchResponseSchema,
        signal,
      }),
    select: (data) => data.people,
    enabled: q.length >= SEARCH_MIN_LENGTH,
  });
  return { ...query, searchedText: q, tooShort: text.trim().length < SEARCH_MIN_LENGTH };
}
