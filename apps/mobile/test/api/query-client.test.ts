import { MutationObserver, onlineManager } from '@tanstack/react-query';
import { ApiError } from '../../src/api/errors.js';
import { createQueryClient, shouldRetryQuery } from '../../src/api/query-client.js';

// Queries retry twice only when it can help (3.2 §3.3); operations never wait paused without
// signal (M9).

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
});
