import { ApiError } from '../../src/api/errors.js';
import { shouldRetryQuery } from '../../src/api/query-client.js';

// Queries retry twice only when it can help (3.2 §3.3).

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
