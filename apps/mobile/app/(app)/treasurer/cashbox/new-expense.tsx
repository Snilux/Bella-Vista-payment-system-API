// T-06 · Registrar gasto
import {
  type CreateExpenseRequest,
  createExpenseRequestSchema,
  type Expense,
  formatMoney,
} from '@bella-vista/shared';
import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { describeError, fieldErrors } from '../../../../src/api/error-messages.js';
import { isApiError } from '../../../../src/api/errors.js';
import { useAgreementOptions } from '../../../../src/api/useAgreements.js';
import { useMyCashbox } from '../../../../src/api/useBilling.js';
import { afterCashMovement } from '../../../../src/api/useCashboxes.js';
import {
  createExpense,
  payExpense,
  useExpenseCategories,
} from '../../../../src/api/useCommittee.js';
import { useMoneyOperation } from '../../../../src/api/useMoneyOperation.js';
import {
  payBlockedReason,
  SAVED_NOT_PAID,
} from '../../../../src/features/committee/committee-view.js';
import {
  DiscardChangesSheet,
  useDiscardGuard,
} from '../../../../src/features/forms/DiscardChangesSheet.js';
import { MoneyFooter } from '../../../../src/features/forms/MoneyFooter.js';
import { agreementLabel } from '../../../../src/features/registry/agreement-view.js';
import {
  AmountField,
  Button,
  DataRow,
  Header,
  Notice,
  ScreenLayout,
  Select,
  SuccessScreen,
  SummaryCard,
  TextField,
} from '../../../../src/ui/index.js';

// A committee expense (Figma T-06; RF-GAS; D-17, D-21): category, description, amount, the
// meeting agreement that approved it and, optionally, the voucher. "Guardar y pagar" is two
// operations in a row, each through useMoneyOperation with its own Idempotency-Key: register
// (POST /expenses) and pay (POST /expenses/{id}/pay). A lost answer while registering is retried
// with the register's key, so the expense is never duplicated; if paying fails for lack of
// balance the expense stays pending and the screen says so, with the way to T-07. Without
// enough balance "Guardar y pagar" is blocked with the reason; "Guardar como pendiente" is not.
// The plumber's salary is paid from T-09, not here.

type Field = 'categoryId' | 'description' | 'amount' | 'agreementId' | 'voucherReference';
type Mode = 'pay' | 'pending';
type Result = Awaited<ReturnType<typeof createExpense>>;

export default function NewExpense() {
  const queryClient = useQueryClient();
  const cashbox = useMyCashbox();
  const categories = useExpenseCategories();
  const agreements = useAgreementOptions('approved_by_majority');
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState<number | null>(null);
  const [agreementId, setAgreementId] = useState<number | null>(null);
  const [voucher, setVoucher] = useState('');
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const mode = useRef<Mode>('pending');

  // Paid or not, the expense list and the cashbox changed.
  const refresh = useCallback(() => afterCashMovement(queryClient), [queryClient]);
  const pay = useMoneyOperation<number, Result>(payExpense, {
    onSuccess: refresh,
    onFailure: refresh,
  });
  // The pay step starts when the register step answers (read through a ref: stable callback).
  const payRef = useRef(pay.submit);
  payRef.current = pay.submit;
  const onRegistered = useCallback(
    ({ expense }: Result) => {
      afterCashMovement(queryClient);
      if (mode.current === 'pay') void payRef.current(expense.id);
    },
    [queryClient],
  );
  const register = useMoneyOperation<CreateExpenseRequest, Result>(createExpense, {
    onSuccess: onRegistered,
  });
  const registered = register.status === 'success' ? (register.data?.expense ?? null) : null;
  const guard = useDiscardGuard(
    (description !== '' || amount !== null || voucher !== '') && registered === null,
    { unknown: register.status === 'unknown' || pay.status === 'unknown' },
  );

  // --- Outcomes -------------------------------------------------------------------------------
  if (registered && mode.current === 'pending') {
    return (
      <Done
        title="Gasto registrado"
        message="Quedó pendiente de pago. Páguelo desde su detalle cuando haya saldo."
        expense={registered}
      />
    );
  }
  if (registered && pay.status === 'success' && pay.data) {
    return (
      <Done
        title="Gasto pagado"
        message="Se descontó de la caja del comité."
        expense={pay.data.expense}
      />
    );
  }
  if (registered && pay.status === 'failed') {
    const noBalance = isApiError(pay.error) && pay.error.code === 'INSUFFICIENT_BALANCE';
    return (
      <ScreenLayout
        footer={
          <Button
            label="Ver el gasto"
            onPress={() => router.replace(`/treasurer/cashbox/expenses/${registered.id}`)}
          />
        }
      >
        <Header title="Registrar gasto" onBack={() => router.back()} />
        <Notice
          title={
            noBalance
              ? SAVED_NOT_PAID
              : `El gasto quedó registrado y pendiente de pago: ${describeError(pay.error).message}`
          }
          detail="Puede pagarlo desde su detalle cuando haya saldo, o rechazarlo."
        />
        <ExpenseSummary expense={registered} />
      </ScreenLayout>
    );
  }

  // --- Form -----------------------------------------------------------------------------------
  const balance = cashbox.data?.balance ?? null;
  const blocked = payBlockedReason(amount, balance);
  const server = register.status === 'failed' ? fieldErrors(register.error) : {};
  const general =
    register.status === 'failed' && Object.keys(server).length === 0
      ? describeError(register.error).message
      : null;
  const errorOf = (field: Field) => errors[field] ?? server[field] ?? null;
  // Once registered (paying, or a paying answer lost) the form is the expense: no edits.
  const locked = registered !== null || register.status === 'unknown' || register.sending;
  const edit =
    <T,>(set: (value: T) => void) =>
    (value: T) => {
      set(value);
      if (register.status === 'failed') register.reset();
    };

  const submit = (next: Mode) => {
    const problems: Partial<Record<Field, string>> = {};
    const parsed = createExpenseRequestSchema.safeParse({
      categoryId: categoryId ?? undefined,
      description,
      amount: amount ?? undefined,
      agreementId: agreementId ?? undefined,
      voucherReference: voucher,
    });
    if (!parsed.success) {
      for (const issue of parsed.error.issues)
        problems[String(issue.path[0]) as Field] ??= issue.message;
    }
    if (amount === null) problems.amount = 'Escriba el importe.';
    setErrors(problems);
    if (!parsed.success || Object.keys(problems).length > 0) return;
    mode.current = next;
    void register.submit(parsed.data);
  };

  // The footer follows the step on its way: registering, or paying what was registered.
  const footer = registered ? (
    <MoneyFooter
      operation={pay}
      label="Pagar"
      loadingLabel="Pagando..."
      onPress={() => void pay.submit(registered.id)}
    />
  ) : (
    <MoneyFooter
      operation={register}
      label="Guardar y pagar"
      onPress={() => submit('pay')}
      disabledReason={blocked}
      secondary={
        <Button
          label="Guardar como pendiente"
          variant="text"
          onPress={() => submit('pending')}
          disabledReason={register.sending ? 'Espere a que termine de guardar.' : null}
        />
      }
    />
  );

  return (
    <ScreenLayout footer={footer}>
      <Header
        title="Registrar gasto"
        {...(balance !== null ? { subtitle: `Caja del comité: ${formatMoney(balance)}` } : {})}
        onBack={() => router.back()}
      />
      <Select
        optionsQuery={categories}
        label="Categoría"
        required
        options={(categories.data ?? [])
          .filter((category) => !category.isPlumberSalary)
          .map((category) => ({ value: category.id, label: category.name }))}
        value={categoryId}
        onChange={edit(setCategoryId)}
        placeholder="Elija la categoría"
        help="El salario del fontanero se paga desde Más → Fontanero."
        error={errorOf('categoryId')}
      />
      <TextField
        label="Descripción"
        required
        value={description}
        onChangeText={edit(setDescription)}
        example="Cambio de válvula, calle Pino"
        maxLength={300}
        error={errorOf('description')}
        editable={!locked}
      />
      <AmountField
        label="Importe"
        required
        valueCents={amount}
        onChangeCents={edit(setAmount)}
        error={errorOf('amount')}
        editable={!locked}
      />
      <Select
        optionsQuery={agreements}
        label="Acuerdo de junta"
        required
        options={(agreements.data ?? []).map((agreement) => ({
          value: agreement.id,
          label: agreementLabel(agreement),
          description: agreement.topic,
        }))}
        value={agreementId}
        onChange={edit(setAgreementId)}
        placeholder="Elija el acuerdo"
        help="Todo gasto necesita el acuerdo de la junta que lo aprobó."
        error={errorOf('agreementId')}
      />
      <TextField
        label="Referencia del comprobante"
        value={voucher}
        onChangeText={edit(setVoucher)}
        help="Opcional. Escriba el número de nota o factura."
        maxLength={100}
        error={errorOf('voucherReference')}
        editable={!locked}
      />
      {blocked && !registered ? <Notice title={blocked} /> : null}
      {registered ? (
        <Notice
          icon="info"
          title={`Gasto ${registered.folio} registrado.`}
          detail={
            pay.status === 'unknown'
              ? 'No sabemos si se pagó. Toque Reintentar: si ya se había pagado, no se descuenta dos veces.'
              : 'Pagándolo de la caja del comité...'
          }
        />
      ) : null}
      {register.status === 'unknown' ? <Notice title="No sabemos si se registró." /> : null}
      {general ? <Notice title={general} /> : null}
      <DiscardChangesSheet guard={guard} />
    </ScreenLayout>
  );
}

function ExpenseSummary({ expense }: { expense: Expense }) {
  return (
    <SummaryCard tone="plain">
      <DataRow label="Folio" value={expense.folio} />
      <DataRow label="Descripción" value={expense.description} />
      <DataRow label="Importe" value={formatMoney(expense.amount)} amount />
    </SummaryCard>
  );
}

function Done({ title, message, expense }: { title: string; message: string; expense: Expense }) {
  return (
    <SuccessScreen
      title={title}
      message={message}
      onDone={() => router.back()}
      doneLabel="Volver a la caja"
      secondary={{
        label: 'Ver el gasto',
        onPress: () => router.replace(`/treasurer/cashbox/expenses/${expense.id}`),
      }}
    >
      <ExpenseSummary expense={expense} />
    </SuccessScreen>
  );
}
