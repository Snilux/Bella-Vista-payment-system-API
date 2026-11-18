// T-10 · Tarifas (Registrar tarifa)
import { addMonths, createRateRequestSchema } from '@bella-vista/shared';
import { router } from 'expo-router';
import { useState } from 'react';
import { describeError, fieldErrors } from '../../../../../src/api/error-messages.js';
import { useAgreementOptions } from '../../../../../src/api/useAgreements.js';
import { useCreateRate } from '../../../../../src/api/useRates.js';
import {
  DiscardChangesSheet,
  useDiscardGuard,
} from '../../../../../src/features/forms/DiscardChangesSheet.js';
import { agreementLabel } from '../../../../../src/features/registry/agreement-view.js';
import { currentPeriod, monthOptions } from '../../../../../src/features/registry/registry-view.js';
import {
  AmountField,
  AppText,
  Button,
  colors,
  DateField,
  Header,
  Notice,
  ScreenLayout,
  Select,
  SuccessScreen,
  TextField,
} from '../../../../../src/ui/index.js';

// A new monthly fee (T-10; D-05, D-20): from a month after the current one, with the meeting
// agreement approved by majority that set it. It stays pending until the president authorizes
// it; a new rate never reprices months already paid.

type Field = 'effectivePeriod' | 'amount' | 'approvedOn' | 'agreementId' | 'reason';

export default function NewRate() {
  const create = useCreateRate();
  const agreements = useAgreementOptions('approved_by_majority');
  const now = currentPeriod();
  const [effectivePeriod, setEffectivePeriod] = useState<string>(addMonths(now, 1));
  const [amount, setAmount] = useState<number | null>(null);
  const [agreementId, setAgreementId] = useState<number | null>(null);
  const [approvedOn, setApprovedOn] = useState('');
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const guard = useDiscardGuard((amount !== null || reason !== '') && !create.isSuccess);

  if (create.isSuccess) {
    return (
      <SuccessScreen
        title="Enviada al presidente"
        message="La tarifa queda pendiente hasta que el presidente la autorice. Mientras tanto se cobra la vigente."
        onDone={() => router.back()}
        doneLabel="Volver a tarifas"
      />
    );
  }

  const server = create.isError ? fieldErrors(create.error) : {};
  const general =
    create.isError && Object.keys(server).length === 0 ? describeError(create.error).message : null;
  const errorOf = (field: Field) => errors[field] ?? server[field] ?? null;

  const chooseAgreement = (id: number) => {
    setAgreementId(id);
    // The approval date is the meeting's, unless the person already wrote another one.
    const meeting = agreements.data?.find((item) => item.id === id)?.meetingDate;
    if (meeting && approvedOn === '') setApprovedOn(meeting);
  };

  const submit = () => {
    const parsed = createRateRequestSchema.safeParse({
      effectivePeriod,
      amount: amount ?? undefined,
      approvedOn: approvedOn.trim(),
      agreementId: agreementId ?? undefined,
      reason,
    });
    if (!parsed.success) {
      const next: Partial<Record<Field, string>> = {};
      for (const issue of parsed.error.issues)
        next[String(issue.path[0]) as Field] ??= issue.message;
      if (amount === null) next.amount = 'Escriba el importe.';
      setErrors(next);
      return;
    }
    setErrors({});
    create.mutate(parsed.data);
  };

  return (
    <ScreenLayout
      footer={<Button label="Enviar al presidente" onPress={submit} loading={create.isPending} />}
    >
      <Header title="Registrar tarifa" onBack={() => router.back()} />
      <Select
        label="Desde el mes"
        required
        options={monthOptions(addMonths(now, 1), addMonths(now, 24))}
        value={effectivePeriod}
        onChange={setEffectivePeriod}
        help="Una tarifa nueva entra en vigor desde un mes posterior al actual."
        error={errorOf('effectivePeriod')}
      />
      <AmountField
        label="Importe mensual"
        required
        valueCents={amount}
        onChangeCents={setAmount}
        error={errorOf('amount')}
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
        onChange={chooseAgreement}
        placeholder="Elija el acuerdo"
        help="Solo acuerdos aprobados por mayoría."
        error={errorOf('agreementId')}
      />
      <DateField
        label="Fecha de aprobación"
        required
        value={approvedOn}
        onChange={setApprovedOn}
        help="La de la junta que la aprobó."
        error={errorOf('approvedOn')}
      />
      <TextField
        label="Motivo"
        value={reason}
        onChangeText={setReason}
        help="El presidente lo leerá al autorizar."
        error={errorOf('reason')}
        maxLength={500}
        multiline
      />
      {general ? <Notice title={general} /> : null}
      <AppText variant="caption" color={colors.textSecondary}>
        Los meses ya pagados conservan la tarifa con la que se pagaron.
      </AppText>
      <DiscardChangesSheet guard={guard} />
    </ScreenLayout>
  );
}
