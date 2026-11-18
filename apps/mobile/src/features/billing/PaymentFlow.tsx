import type { CreatePaymentRequest, Payment, Period } from '@bella-vista/shared';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { MoneyAttempt, MoneyAttemptStore } from '../../api/useMoneyOperation.js';

// The state of the payment flow (3.2 §10.3): F-02 → F-03 → F-04 share who is paid (a family or
// the opening of a request), the months, the charges, the paper folio and the attempt whose
// answer never arrived (its Idempotency-Key). It lives in the layout of common/new-payment:
// going back keeps what was written; leaving the flow (the layout unmounts) forgets it all.

export type PaymentTarget =
  | { kind: 'unit'; unitId: number }
  | { kind: 'opening'; requestId: number };

type FlowState = {
  target: PaymentTarget | null;
  periods: Period[];
  chargeIds: number[];
  paperFolio: string;
  /** A message for F-02 after the API refused the summary (TOTAL_CHANGED, MONTH_ORDER…). */
  notice: string | null;
  /** The registered payment, for F-04. */
  result: Payment | null;
};

const EMPTY: FlowState = {
  target: null,
  periods: [],
  chargeIds: [],
  paperFolio: '',
  notice: null,
  result: null,
};

type PaymentFlow = FlowState & {
  /** Starts the flow for a target (keeps everything when it is the same one). */
  start: (target: PaymentTarget) => void;
  setPeriods: (periods: Period[]) => void;
  setChargeIds: (ids: number[]) => void;
  setPaperFolio: (folio: string) => void;
  setNotice: (notice: string | null) => void;
  finish: (payment: Payment) => void;
  /** "Cobrar a otra familia": a new, empty flow. */
  reset: () => void;
  /** Where useMoneyOperation keeps the unanswered attempt (its data and key). */
  attempt: MoneyAttemptStore<CreatePaymentRequest>;
  /** True while a registration may have gone in without an answer. */
  hasUnansweredAttempt: boolean;
};

const Context = createContext<PaymentFlow | null>(null);

const sameTarget = (a: PaymentTarget | null, b: PaymentTarget) =>
  a !== null &&
  a.kind === b.kind &&
  (a.kind === 'unit'
    ? a.unitId === (b as { unitId: number }).unitId
    : a.requestId === (b as { requestId: number }).requestId);

export function PaymentFlowProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<FlowState>(EMPTY);
  const attemptRef = useRef<MoneyAttempt<CreatePaymentRequest> | null>(null);
  const [hasUnansweredAttempt, setHasUnanswered] = useState(false);

  // Stable functions: screens call them from effects.
  const start = useCallback(
    (target: PaymentTarget) =>
      setState((current) =>
        // An unanswered attempt keeps its flow: its data must not change before the retry.
        sameTarget(current.target, target) || attemptRef.current ? current : { ...EMPTY, target },
      ),
    [],
  );
  const setPeriods = useCallback(
    (periods: Period[]) => setState((current) => ({ ...current, periods, notice: null })),
    [],
  );
  const setChargeIds = useCallback(
    (chargeIds: number[]) => setState((current) => ({ ...current, chargeIds })),
    [],
  );
  const setPaperFolio = useCallback(
    (paperFolio: string) => setState((current) => ({ ...current, paperFolio })),
    [],
  );
  const setNotice = useCallback(
    (notice: string | null) => setState((current) => ({ ...current, notice })),
    [],
  );
  const finish = useCallback(
    (result: Payment) => setState((current) => ({ ...current, result })),
    [],
  );
  const reset = useCallback(() => {
    attemptRef.current = null;
    setHasUnanswered(false);
    setState(EMPTY);
  }, []);
  const attempt = useMemo<MoneyAttemptStore<CreatePaymentRequest>>(
    () => ({
      get: () => attemptRef.current,
      set: (next) => {
        attemptRef.current = next;
        setHasUnanswered(next !== null);
      },
    }),
    [],
  );

  const value = useMemo<PaymentFlow>(
    () => ({
      ...state,
      start,
      setPeriods,
      setChargeIds,
      setPaperFolio,
      setNotice,
      finish,
      reset,
      attempt,
      hasUnansweredAttempt,
    }),
    [
      state,
      hasUnansweredAttempt,
      start,
      setPeriods,
      setChargeIds,
      setPaperFolio,
      setNotice,
      finish,
      reset,
      attempt,
    ],
  );

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function usePaymentFlow(): PaymentFlow {
  const flow = useContext(Context);
  if (!flow) throw new Error('usePaymentFlow outside common/new-payment');
  return flow;
}
