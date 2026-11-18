import { QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import type { ApiClient } from '../../src/api/client.js';
import { createQueryClient } from '../../src/api/query-client.js';
import { useChangePassword, useLogin } from '../../src/api/useAuth.js';
import { apiError } from '../api/fake-api.js';

// M9 (3.2 §3.2): the passwords typed in C-01 and C-02 travel in TanStack Query's mutation
// variables; they must not stay in its cache once the screen that sent them closes.

jest.mock('expo-secure-store', () => ({
  getItemAsync: () => Promise.resolve(null),
  setItemAsync: () => Promise.resolve(),
  deleteItemAsync: () => Promise.resolve(),
}));
const mockState: { client: ApiClient | null } = { client: null };
jest.mock('../../src/api/api.js', () => ({ getApiClient: () => mockState.client }));

const PASSWORD = 'secreta-del-tesorero-1';

beforeEach(() => {
  const { createApiClient } = jest.requireActual('../../src/api/client.js');
  const { scriptedFetch, memoryTokens } = jest.requireActual('../api/fake-api.js');
  mockState.client = createApiClient({
    baseUrl: 'http://api.test:3000',
    tokens: memoryTokens({ access: 'access-0', refresh: 'refresh-0' }).store,
    onSessionEnded: () => undefined,
    fetchFn: scriptedFetch(() => apiError(401, 'INVALID_CREDENTIALS')).fetchFn,
  });
});

const cached = (client: ReturnType<typeof createQueryClient>) =>
  JSON.stringify(
    client
      .getMutationCache()
      .getAll()
      .map((mutation) => mutation.state.variables),
  );

const wrapperFor =
  (client: ReturnType<typeof createQueryClient>) =>
  ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );

it('C-01 sign in leaves no password in the cache after the screen closes', async () => {
  const client = createQueryClient();
  const { result, unmount } = await renderHook(() => useLogin(), { wrapper: wrapperFor(client) });
  await act(async () => {
    await result.current
      .mutateAsync({ username: 'tesorero', password: PASSWORD })
      .catch(() => undefined);
  });
  expect(cached(client)).toContain(PASSWORD);
  await unmount();
  await waitFor(() => expect(cached(client)).not.toContain(PASSWORD));
  client.clear();
});

it('C-02 new password leaves no password in the cache after the screen closes', async () => {
  const client = createQueryClient();
  const { result, unmount } = await renderHook(() => useChangePassword(), {
    wrapper: wrapperFor(client),
  });
  await act(async () => {
    await result.current
      .mutateAsync({ currentPassword: PASSWORD, newPassword: `${PASSWORD}-nueva` })
      .catch(() => undefined);
  });
  expect(cached(client)).toContain(PASSWORD);
  await unmount();
  await waitFor(() => expect(cached(client)).not.toContain(PASSWORD));
  client.clear();
});
