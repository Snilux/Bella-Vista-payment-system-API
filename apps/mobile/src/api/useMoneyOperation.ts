import { randomUUID } from 'expo-crypto';
import { useCallback, useRef, useState } from 'react';
import { isNetworkError } from './errors.js';

// Hook de operación de dinero (3.2 §3.3 and §11.1), shared by every POST that needs an
// Idempotency-Key (payments, handovers, expenses, cancellations, refunds…):
// - the key is generated when the person taps Confirm and kept until an answer arrives;
// - a second tap while the first one is on its way sends nothing (the ref, not the state,
//   decides: two taps can land before React renders "Guardando...");
// - it never retries by itself. No answer at all (NETWORK_ERROR) means nobody knows if it went
//   in: the status is "unknown" and retry() sends the same data with the same key, so the API
//   answers the stored result instead of registering it twice;
// - any answer of the API (success or error) ends that key: a new attempt gets a new one.
// Operations without a key (e.g. a request without money) can use it too, with `idempotent:
// false`: they still get the double-tap guard and the "unknown" state.

export type MoneyOperationStatus = 'idle' | 'sending' | 'success' | 'failed' | 'unknown';

export type MoneyOperationState<TResult> = {
  status: MoneyOperationStatus;
  data: TResult | undefined;
  /** The error of the last attempt (status failed or unknown). */
  error: unknown;
};

/** An attempt whose outcome is unknown: the data and the key the retry must send again. */
export type MoneyAttempt<TVars> = { vars: TVars; key: string | undefined };

/**
 * Where the unanswered attempt lives. By default inside the hook; a flow that spans several
 * screens (the payment flow) keeps it in its context, so going back and forth never loses the
 * key of a payment that may have gone in.
 */
export type MoneyAttemptStore<TVars> = {
  get(): MoneyAttempt<TVars> | null;
  set(attempt: MoneyAttempt<TVars> | null): void;
};

export type MoneyOperationOptions<TResult, TVars = unknown> = {
  /** False for operations the API does not key; the default is true. */
  idempotent?: boolean;
  onSuccess?: (result: TResult) => void;
  /** The API answered with an error (not a lost answer): the key is already forgotten. */
  onFailure?: (error: unknown) => void;
  /** Only for tests; the app uses expo-crypto's randomUUID. */
  newKey?: () => string;
  attemptStore?: MoneyAttemptStore<TVars>;
};

type Pending<TVars> = MoneyAttempt<TVars>;

export function useMoneyOperation<TVars, TResult>(
  send: (vars: TVars, idempotencyKey: string | undefined) => Promise<TResult>,
  options: MoneyOperationOptions<TResult, TVars> = {},
) {
  const { idempotent = true, onSuccess, onFailure, newKey = randomUUID, attemptStore } = options;
  const inFlight = useRef(false);
  /** The attempt whose outcome is unknown: retry() sends exactly this again. */
  const ownAttempt = useRef<Pending<TVars> | null>(null);
  const store: MoneyAttemptStore<TVars> = attemptStore ?? {
    get: () => ownAttempt.current,
    set: (attempt) => {
      ownAttempt.current = attempt;
    },
  };
  // The latest store, read inside run() without making it a dependency.
  const storeRef = useRef(store);
  storeRef.current = store;
  // A flow that comes back with an unanswered attempt shows "No sabemos si se registró" again.
  const [state, setState] = useState<MoneyOperationState<TResult>>(() => ({
    status: store.get() ? 'unknown' : 'idle',
    data: undefined,
    error: null,
  }));

  const run = useCallback(
    async (pending: Pending<TVars>) => {
      if (inFlight.current) return;
      inFlight.current = true;
      setState((current) => ({ ...current, status: 'sending', error: null }));
      try {
        const result = await send(pending.vars, pending.key);
        storeRef.current.set(null);
        setState({ status: 'success', data: result, error: null });
        onSuccess?.(result);
      } catch (error) {
        if (isNetworkError(error)) {
          storeRef.current.set(pending);
          setState({ status: 'unknown', data: undefined, error });
        } else {
          storeRef.current.set(null);
          setState({ status: 'failed', data: undefined, error });
          onFailure?.(error);
        }
      } finally {
        inFlight.current = false;
      }
    },
    [send, onSuccess, onFailure],
  );

  return {
    ...state,
    sending: state.status === 'sending',
    /** Confirm: a new key per operation (or the same attempt again while its outcome is unknown). */
    submit: (vars: TVars) => run(store.get() ?? { vars, key: idempotent ? newKey() : undefined }),
    /** "Reintentar" after "No sabemos si se registró": same data, same key. */
    retry: () => {
      const attempt = store.get();
      return attempt ? run(attempt) : Promise.resolve();
    },
    /** Back to the form (e.g. after an error the person will fix): forgets the attempt. */
    reset: () => {
      if (inFlight.current) return;
      store.set(null);
      setState({ status: 'idle', data: undefined, error: null });
    },
  };
}
