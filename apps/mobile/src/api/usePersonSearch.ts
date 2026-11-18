import { type SearchResponse, searchResponseSchema } from '@bella-vista/shared';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { requireApiClient } from './api.js';
import { queryKeys } from './keys.js';

// Búsqueda (3.2 §11.2 "Búsquedas"; G-01 and the pickers): waits 400 ms after the last letter,
// needs 2 letters and cancels the previous request (TanStack Query aborts the old key's signal).
// The API decides what each role receives: a block leader gets no connection or unit of
// another block, and of a person outside their scope only name, distinguishing note and folio.

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

function useSearchQuery<T>(text: string, select: (data: SearchResponse) => T) {
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
    select,
    enabled: q.length >= SEARCH_MIN_LENGTH,
  });
  return { ...query, searchedText: q, tooShort: text.trim().length < SEARCH_MIN_LENGTH };
}

const everything = (data: SearchResponse) => data;
const people = (data: SearchResponse) => data.people;

/** G-01 and the suspension target: people, connections and units. */
export function useSearch(text: string) {
  return useSearchQuery(text, everything);
}

/** The person pickers (S-07, G-11, P-03 to P-05). */
export function usePersonSearch(text: string) {
  return useSearchQuery(text, people);
}
