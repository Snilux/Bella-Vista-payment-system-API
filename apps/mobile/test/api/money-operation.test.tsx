import { act, renderHook } from '@testing-library/react-native';
import { ApiError } from '../../src/api/errors.js';
import { useMoneyOperation } from '../../src/api/useMoneyOperation.js';

// Hook de operación de dinero (3.2 §3.3, §11.1): one key per operation, kept while nobody knows
// whether it went in; a double tap sends once; it never retries by itself.

jest.mock('expo-crypto', () => ({ randomUUID: () => 'expo-uuid' }));

const networkError = () => new ApiError('NETWORK_ERROR', 0, 'Sin conexión');

function setup(send: jest.Mock, options: { idempotent?: boolean } = {}) {
  let n = 0;
  return renderHook(() =>
    useMoneyOperation<{ amount: number }, string>(send, { ...options, newKey: () => `k${++n}` }),
  );
}

describe('useMoneyOperation', () => {
  it('sends once on a double tap', async () => {
    let finish: (value: string) => void = () => undefined;
    const send = jest.fn(() => new Promise<string>((resolve) => (finish = resolve)));
    const { result } = await setup(send);

    await act(async () => {
      void result.current.submit({ amount: 100 });
      void result.current.submit({ amount: 100 });
    });
    expect(result.current.status).toBe('sending');
    expect(result.current.sending).toBe(true);
    await act(async () => finish('PG-1'));
    expect(send).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe('success');
    expect(result.current.data).toBe('PG-1');
  });

  it('keeps the key and the data for "Reintentar" when nobody knows if it went in', async () => {
    const send = jest.fn().mockRejectedValueOnce(networkError()).mockResolvedValueOnce('PG-1');
    const onSuccess = jest.fn();
    let n = 0;
    const { result } = await renderHook(() =>
      useMoneyOperation<{ amount: number }, string>(send, { onSuccess, newKey: () => `k${++n}` }),
    );

    await act(() => result.current.submit({ amount: 100 }));
    expect(result.current.status).toBe('unknown');
    expect(onSuccess).not.toHaveBeenCalled();

    await act(() => result.current.retry());
    expect(send.mock.calls).toEqual([
      [{ amount: 100 }, 'k1'],
      [{ amount: 100 }, 'k1'],
    ]);
    expect(result.current.status).toBe('success');
    expect(onSuccess).toHaveBeenCalledWith('PG-1');
  });

  it('confirming again while the outcome is unknown repeats that same attempt', async () => {
    const send = jest.fn().mockRejectedValueOnce(networkError()).mockResolvedValueOnce('PG-1');
    const { result } = await setup(send);
    await act(() => result.current.submit({ amount: 100 }));
    await act(() => result.current.submit({ amount: 999 }));
    expect(send.mock.calls[1]).toEqual([{ amount: 100 }, 'k1']);
  });

  it('an answer of the API ends the key: the next attempt has a new one', async () => {
    const send = jest
      .fn()
      .mockRejectedValueOnce(new ApiError('INSUFFICIENT_BALANCE', 422, 'Sin saldo'))
      .mockResolvedValueOnce('PG-2');
    const { result } = await setup(send);

    await act(() => result.current.submit({ amount: 100 }));
    expect(result.current.status).toBe('failed');
    expect(result.current.error).toBeInstanceOf(ApiError);
    await act(() => result.current.retry());
    expect(send).toHaveBeenCalledTimes(1);

    await act(() => result.current.submit({ amount: 50 }));
    expect(send.mock.calls[1]).toEqual([{ amount: 50 }, 'k2']);
  });

  it('sends no key for operations the API does not key', async () => {
    const send = jest.fn().mockResolvedValue('ok');
    const { result } = await setup(send, { idempotent: false });
    await act(() => result.current.submit({ amount: 1 }));
    expect(send).toHaveBeenCalledWith({ amount: 1 }, undefined);
  });

  it('reset forgets the attempt', async () => {
    const send = jest.fn().mockRejectedValueOnce(networkError()).mockResolvedValueOnce('PG-3');
    const { result } = await setup(send);
    await act(() => result.current.submit({ amount: 100 }));
    await act(async () => result.current.reset());
    expect(result.current.status).toBe('idle');
    await act(() => result.current.submit({ amount: 70 }));
    expect(send.mock.calls[1]).toEqual([{ amount: 70 }, 'k2']);
  });
});

describe('useMoneyOperation with an external attempt store (the payment flow)', () => {
  it('keeps the unanswered attempt outside the screen: a new screen retries with the same key', async () => {
    let attempt: { vars: { amount: number }; key: string | undefined } | null = null;
    const store = {
      get: () => attempt,
      set: (next: typeof attempt) => {
        attempt = next;
      },
    };
    const send = jest.fn().mockRejectedValueOnce(networkError()).mockResolvedValueOnce('PG-9');
    let n = 0;
    const first = await renderHook(() =>
      useMoneyOperation<{ amount: number }, string>(send, {
        attemptStore: store,
        newKey: () => `k${++n}`,
      }),
    );
    await act(() => first.result.current.submit({ amount: 100 }));
    expect(attempt).toEqual({ vars: { amount: 100 }, key: 'k1' });
    await first.unmount();

    // F-03 again (after going back to F-02): it starts as "unknown" and retries the same attempt.
    const second = await renderHook(() =>
      useMoneyOperation<{ amount: number }, string>(send, {
        attemptStore: store,
        newKey: () => `k${++n}`,
      }),
    );
    expect(second.result.current.status).toBe('unknown');
    await act(() => second.result.current.retry());
    expect(send.mock.calls[1]).toEqual([{ amount: 100 }, 'k1']);
    expect(attempt).toBeNull();
  });

  it('tells onFailure about an answer of the API, never about a lost one', async () => {
    const onFailure = jest.fn();
    const send = jest
      .fn()
      .mockRejectedValueOnce(networkError())
      .mockRejectedValueOnce(new ApiError('TOTAL_CHANGED', 409, 'Cambió'));
    const { result } = await renderHook(() =>
      useMoneyOperation<{ amount: number }, string>(send, { onFailure, newKey: () => 'k' }),
    );
    await act(() => result.current.submit({ amount: 1 }));
    expect(onFailure).not.toHaveBeenCalled();
    await act(() => result.current.retry());
    expect(onFailure).toHaveBeenCalledWith(expect.objectContaining({ code: 'TOTAL_CHANGED' }));
  });
});
