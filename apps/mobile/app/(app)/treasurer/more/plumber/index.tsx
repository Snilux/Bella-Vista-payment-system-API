// T-08 · Fontanero
import {
  createPlumberRequestSchema,
  createPlumberSalaryRequestSchema,
  formatMoney,
  type PlumberDetail,
  SALARY_FREQUENCIES,
} from '@bella-vista/shared';
import { router } from 'expo-router';
import { type ReactNode, useState } from 'react';
import { View } from 'react-native';
import { describeError, fieldErrors } from '../../../../../src/api/error-messages.js';
import { useAgreementOptions } from '../../../../../src/api/useAgreements.js';
import {
  useCreatePlumber,
  useCreateSalary,
  usePlumber,
  usePlumbers,
} from '../../../../../src/api/useCommittee.js';
import { APPROVAL_STATUS_TAGS } from '../../../../../src/features/approvals/approval-types.js';
import {
  EXPENSE_TAGS,
  FREQUENCY_LABELS,
  payPeriodShort,
} from '../../../../../src/features/committee/committee-view.js';
import { businessToday } from '../../../../../src/features/forms/business-date.js';
import { agreementLabel } from '../../../../../src/features/registry/agreement-view.js';
import {
  AmountField,
  AppText,
  BottomSheet,
  Button,
  colors,
  DataRow,
  DateField,
  Header,
  ListRow,
  Notice,
  ScreenLayout,
  ScreenState,
  Select,
  SummaryCard,
  screenStatusOf,
  TextField,
} from '../../../../../src/ui/index.js';

// The committee's plumber (Figma T-08; RF-GAS-08; D-24): the authorized salary in force, its
// history and the payments, "Pagar periodo" (T-09) and "Cambiar salario". A salary registered or
// changed here stays pending until the president authorizes it (the payments keep the one in
// force meanwhile). Without a plumber, "Registrar fontanero".

export default function Plumber() {
  const plumbers = usePlumbers();
  const current = plumbers.data?.find((item) => item.active) ?? plumbers.data?.[0] ?? null;
  const detail = usePlumber(current?.id ?? null);
  const [adding, setAdding] = useState(false);
  const header = (
    <Header
      title="Fontanero"
      {...(detail.data
        ? {
            subtitle: [detail.data.name, detail.data.phone].filter(Boolean).join(' · '),
          }
        : {})}
      onBack={() => router.back()}
    />
  );

  if (plumbers.data && plumbers.data.length === 0) {
    return (
      <ScreenLayout footer={<Button label="Registrar fontanero" onPress={() => setAdding(true)} />}>
        {header}
        <Notice
          icon="info"
          title="El comité aún no tiene fontanero registrado."
          detail="Regístrelo y después capture su salario con el acuerdo de la junta."
        />
        <NewPlumberSheet visible={adding} onClose={() => setAdding(false)} />
      </ScreenLayout>
    );
  }
  const status = plumbers.isError ? screenStatusOf(plumbers) : screenStatusOf(detail);
  if (!detail.data) {
    return (
      <ScreenLayout>
        {header}
        <ScreenState
          status={plumbers.data ? status : screenStatusOf(plumbers)}
          error={plumbers.error ?? detail.error}
          onRetry={() => {
            void plumbers.refetch();
            void detail.refetch();
          }}
        />
      </ScreenLayout>
    );
  }
  return <PlumberDetailView plumber={detail.data} header={header} />;
}

function PlumberDetailView({ plumber, header }: { plumber: PlumberDetail; header: ReactNode }) {
  const [changing, setChanging] = useState(false);
  const [sent, setSent] = useState(false);
  const salary = plumber.currentSalary;
  const pending = plumber.salaries.find((item) => item.status === 'pending');

  return (
    <ScreenLayout>
      {header}
      {salary ? (
        <SummaryCard heading={{ label: 'Salario fijo', amountCents: salary.amount }}>
          <DataRow label="Periodicidad" value={FREQUENCY_LABELS[salary.frequency]} />
          <DataRow label="Acuerdo" value={salary.agreement.folio} />
          <DataRow label="Desde" value={salary.effectiveFrom} />
        </SummaryCard>
      ) : (
        <Notice
          title="Sin salario autorizado."
          detail="Capture el salario con «Cambiar salario»; se paga cuando el presidente lo autorice."
        />
      )}
      {pending ? (
        <Notice
          icon="info"
          title={`Salario de ${formatMoney(pending.amount)} (${FREQUENCY_LABELS[pending.frequency].toLowerCase()}) desde ${pending.effectiveFrom}: pendiente de autorizar.`}
          detail="Mientras el presidente no lo autorice, se paga el salario vigente."
        />
      ) : null}
      {sent && !pending ? <Notice icon="success" title="Enviado al presidente." /> : null}
      <Button
        label="Pagar periodo"
        onPress={() =>
          router.push({
            pathname: '/treasurer/more/plumber/pay',
            params: { id: String(plumber.id) },
          })
        }
        disabledReason={
          !plumber.active
            ? 'El fontanero no está activo.'
            : salary
              ? null
              : 'No tiene un salario autorizado.'
        }
      />

      <AppText variant="heading">Pagos</AppText>
      {plumber.payments.length === 0 ? (
        <AppText variant="caption" color={colors.textSecondary}>
          Aún no se le ha pagado ningún periodo.
        </AppText>
      ) : (
        <View>
          {plumber.payments.map((payment) => (
            <ListRow
              key={payment.expenseId}
              title={payPeriodShort(payment.periodStart, payment.periodEnd)}
              subtitle={payment.folio}
              amountCents={payment.amount}
              {...(payment.status === 'paid' ? {} : { tag: EXPENSE_TAGS[payment.status] })}
              onPress={() => router.push(`/treasurer/cashbox/expenses/${payment.expenseId}`)}
            />
          ))}
        </View>
      )}

      <AppText variant="heading">Historial de salarios</AppText>
      <View>
        {plumber.salaries.map((item) => (
          <ListRow
            key={item.id}
            title={`${formatMoney(item.amount)} · ${FREQUENCY_LABELS[item.frequency]}`}
            subtitle={`Desde ${item.effectiveFrom} · ${item.agreement.folio}`}
            tag={APPROVAL_STATUS_TAGS[item.status]}
          />
        ))}
      </View>

      <Button
        label="Cambiar salario"
        variant="text"
        onPress={() => setChanging(true)}
        disabledReason={pending ? 'Ya hay un salario pendiente de autorizar.' : null}
      />
      <SalarySheet
        plumberId={plumber.id}
        visible={changing}
        onClose={() => setChanging(false)}
        onSent={() => {
          setChanging(false);
          setSent(true);
        }}
      />
    </ScreenLayout>
  );
}

type SalaryField = 'amount' | 'frequency' | 'effectiveFrom' | 'agreementId' | 'reason';

/** "Cambiar salario": a new salary from a date, with its agreement; the president authorizes it. */
function SalarySheet({
  plumberId,
  visible,
  onClose,
  onSent,
}: {
  plumberId: number;
  visible: boolean;
  onClose: () => void;
  onSent: () => void;
}) {
  const create = useCreateSalary(plumberId);
  const agreements = useAgreementOptions('approved_by_majority');
  const [amount, setAmount] = useState<number | null>(null);
  const [frequency, setFrequency] = useState<(typeof SALARY_FREQUENCIES)[number]>('biweekly');
  const [effectiveFrom, setEffectiveFrom] = useState(businessToday());
  const [agreementId, setAgreementId] = useState<number | null>(null);
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<Partial<Record<SalaryField, string>>>({});
  const server = create.isError ? fieldErrors(create.error) : {};
  const general =
    create.isError && Object.keys(server).length === 0 ? describeError(create.error).message : null;
  const errorOf = (field: SalaryField) => errors[field] ?? server[field] ?? null;

  const submit = () => {
    const parsed = createPlumberSalaryRequestSchema.safeParse({
      amount: amount ?? undefined,
      frequency,
      effectiveFrom,
      agreementId: agreementId ?? undefined,
      reason,
    });
    if (!parsed.success) {
      const next: Partial<Record<SalaryField, string>> = {};
      for (const issue of parsed.error.issues)
        next[String(issue.path[0]) as SalaryField] ??= issue.message;
      if (amount === null) next.amount = 'Escriba el salario.';
      setErrors(next);
      return;
    }
    setErrors({});
    create.mutate(parsed.data, { onSuccess: onSent });
  };

  return (
    <BottomSheet
      visible={visible}
      title="Cambiar salario"
      onClose={create.isPending ? () => undefined : onClose}
      footer={
        <>
          <Button label="Enviar al presidente" onPress={submit} loading={create.isPending} />
          <Button label="Volver" variant="secondary" onPress={onClose} />
        </>
      }
    >
      <AmountField
        label="Salario"
        required
        valueCents={amount}
        onChangeCents={setAmount}
        error={errorOf('amount')}
      />
      <Select
        label="Periodicidad"
        required
        options={SALARY_FREQUENCIES.map((value) => ({ value, label: FREQUENCY_LABELS[value] }))}
        value={frequency}
        onChange={setFrequency}
        error={errorOf('frequency')}
      />
      <DateField
        label="Desde"
        required
        value={effectiveFrom}
        onChange={setEffectiveFrom}
        error={errorOf('effectiveFrom')}
      />
      <Select
        label="Acuerdo de junta"
        required
        options={(agreements.data ?? []).map((agreement) => ({
          value: agreement.id,
          label: agreementLabel(agreement),
          description: agreement.topic,
        }))}
        value={agreementId}
        onChange={setAgreementId}
        placeholder="Elija el acuerdo"
        error={errorOf('agreementId')}
      />
      <TextField
        label="Motivo"
        value={reason}
        onChangeText={setReason}
        help="El presidente lo leerá al autorizar."
        maxLength={500}
        multiline
        error={errorOf('reason')}
      />
      <AppText variant="caption" color={colors.textSecondary}>
        Queda pendiente hasta que el presidente lo autorice; mientras tanto se paga el vigente.
      </AppText>
      {general ? <Notice title={general} /> : null}
    </BottomSheet>
  );
}

/** "Registrar fontanero": name and phone; the salary is captured afterwards. */
function NewPlumberSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const create = useCreatePlumber();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState<string | null>(null);
  const submit = () => {
    const parsed = createPlumberRequestSchema.safeParse({ name, phone });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Revise los datos.');
      return;
    }
    setError(null);
    create.mutate(parsed.data, { onSuccess: onClose });
  };
  return (
    <BottomSheet
      visible={visible}
      title="Registrar fontanero"
      onClose={create.isPending ? () => undefined : onClose}
      footer={<Button label="Guardar" onPress={submit} loading={create.isPending} />}
    >
      <TextField
        label="Nombre"
        required
        value={name}
        onChangeText={setName}
        maxLength={150}
        error={error}
      />
      <TextField
        label="Teléfono"
        value={phone}
        onChangeText={setPhone}
        keyboardType="phone-pad"
        maxLength={20}
      />
      {create.isError ? <Notice title={describeError(create.error).message} /> : null}
    </BottomSheet>
  );
}
