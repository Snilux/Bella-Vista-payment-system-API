import { MutationObserver, onlineManager, QueryObserver } from '@tanstack/react-query';
import { ApiError } from '../../src/api/errors.js';
import {
  createQueryClient,
  FRESH_FOR_MS,
  refreshShownQueries,
  shouldRetryQuery,
} from '../../src/api/query-client.js';

// Queries retry twice only when it can help (3.2 §3.3); operations never wait paused without
// signal; a tab that gains focus reloads what is stale (M9).

describe('shouldRetryQuery', () => {
  it.each([
    ['no connection', new ApiError('NETWORK_ERROR', 0, ''), 0, true],
    ['server error', new ApiError('DATABASE_UNAVAILABLE', 503, ''), 1, true],
    ['after two retries', new ApiError('NETWORK_ERROR', 0, ''), 2, false],
    ['a 4xx answer', new ApiError('NOT_FOUND', 404, ''), 0, false],
    ['no permission', new ApiError('FORBIDDEN', 403, ''), 0, false],
    ['not an API error', new Error('boom'), 0, false],
  ])('%s → %s', (_name, error, failures, expected) => {
    expect(shouldRetryQuery(failures as number, error)).toBe(expected);
  });
});

describe('createQueryClient (M9)', () => {
  afterEach(() => onlineManager.setOnline(true));

  it('without signal an operation fails at once instead of waiting paused', async () => {
    onlineManager.setOnline(false);
    const client = createQueryClient();
    const send = jest.fn(() => Promise.reject(new ApiError('NETWORK_ERROR', 0, '')));
    const observer = new MutationObserver(client, { mutationFn: send });
    await expect(observer.mutate()).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
    expect(send).toHaveBeenCalledTimes(1);
    expect(observer.getCurrentResult().isPaused).toBe(false);
    client.clear(); // no garbage-collection timers left behind
  });

  it('a tab that gains focus reloads only what is older than 30 s', async () => {
    const client = createQueryClient();
    const fresh = jest.fn(() => Promise.resolve('fresh'));
    const old = jest.fn(() => Promise.resolve('old'));
    client.setQueryData(['fresh'], 'cached');
    client.setQueryData(['old'], 'cached', { updatedAt: Date.now() - FRESH_FOR_MS - 1 });
    const watch = (queryKey: string[], queryFn: () => Promise<string>) =>
      new QueryObserver(client, { queryKey, queryFn, refetchOnMount: false }).subscribe(
        () => undefined,
      );
    const stop = [watch(['fresh'], fresh), watch(['old'], old)];

    await refreshShownQueries(client, { staleOnly: true });
    expect(fresh).not.toHaveBeenCalled();
    expect(old).toHaveBeenCalledTimes(1);

    // "Tirar para recargar" reloads everything on screen.
    await refreshShownQueries(client, { staleOnly: false });
    expect(fresh).toHaveBeenCalledTimes(1);
    for (const unsubscribe of stop) unsubscribe();
    client.clear();
  });
});
