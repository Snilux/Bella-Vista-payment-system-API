import { useQuery } from '@tanstack/react-query';
import { getApiClient } from './api.js';
import { ApiError } from './errors.js';
import { queryKeys } from './keys.js';

/**
 * GET /health: whether the API and its database answer (M1 acceptance: the app reaches it).
 * Disabled while EXPO_PUBLIC_API_URL is missing; the screen explains it.
 */
export function useHealth() {
  const client = getApiClient();
  return useQuery({
    queryKey: queryKeys.health,
    enabled: client !== null,
    queryFn: async ({ signal }) => {
      if (!client) throw new ApiError('INVALID_REQUEST', 0, 'Falta EXPO_PUBLIC_API_URL.');
      if (!(await client.health(signal))) {
        throw new ApiError('DATABASE_UNAVAILABLE', 503, 'El servidor no responde.');
      }
      return true;
    },
  });
}
