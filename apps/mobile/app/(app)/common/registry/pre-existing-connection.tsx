// P-03 · Registrar toma y familia existentes
import {
  addMonths,
  createPreexistingConnectionRequestSchema,
  type PersonBasic,
} from '@bella-vista/shared';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { describeError, fieldErrors } from '../../../../src/api/error-messages.js';
import {
  useApprovedRates,
  useCreatePreexistingConnection,
} from '../../../../src/api/useRegistry.js';
import {
  DiscardChangesSheet,
  useDiscardGuard,
} from '../../../../src/features/forms/DiscardChangesSheet.js';
import { PersonPicker } from '../../../../src/features/people/PersonPicker.js';
import { BlockField, useFixedBlock } from '../../../../src/features/registry/BlockField.js';
import {
  type PersonParams,
  personFromParams,
} from '../../../../src/features/registry/navigation.js';
import {
  currentPeriod,
  estimateDebt,
  monthOptions,
} from '../../../../src/features/registry/registry-view.js';
import {
  AppText,
  Button,
  colors,
  Header,
  Notice,
  ScreenLayout,
  Select,
  TextField,
} from '../../../../src/ui/index.js';

// A connection and its family that existed before the system (Figma P-03; 3.2 §10.4; D-18):
// address, block, holder, reference and the first pending month of the paper ledger. While the
// month is chosen, the screen estimates the debt with the same function the API uses
// (computeAccountStatement) and the approved rates, marked as an estimate to compare with the
// ledger; the API computes the real statement once saved.

type Field =
  | 'address'
  | 'blockId'
  | 'activatedOn'
  | 'holderPersonId'
  | 'reference'
  | 'billingStartPeriod';

/** The paper ledger goes back at most five years. */
const LEDGER_MONTHS = 60;

export default function PreexistingConnection() {
  const params = useLocalSearchParams<PersonParams>();
  const fixedBlock = useFixedBlock();
  const rates = useApprovedRates();
  const create = useCreatePreexistingConnection();
  const [address, setAddress] = useState('');
  const [blockId, setBlockId] = useState<number | null>(fixedBlock);
  const [holder, setHolder] = useState<PersonBasic | null>(personFromParams(params));
  const [search, setSearch] = useState('');
  const [reference, setReference] = useState('');
  const [activatedOn, setActivatedOn] = useState('');
  const [billingStart, setBillingStart] = useState<string | null>(null);
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});

  const guard = useDiscardGuard((address !== '' || billingStart !== null) && !create.isSuccess);
  const now = currentPeriod();
  const estimate =
    billingStart && rates.data
      ? estimateDebt(
          billingStart,
          rates.data.map((rate) => ({
            id: rate.id,
            effectivePeriod: rate.effectivePeriod,
            amount: rate.amount,
          })),
        )
      : null;

  const server = create.isError ? fieldErrors(create.error) : {};
  const general =
    create.isError && Object.keys(server).length === 0 ? describeError(create.error).message : null;
  const errorOf = (field: Field) => errors[field] ?? server[field] ?? null;

  const submit = () => {
    const parsed = createPreexistingConnectionRequestSchema.safeParse({
      address,
      blockId: blockId ?? undefined,
      ...(activatedOn.trim() ? { activatedOn: activatedOn.trim() } : {}),
      unit: {
        holderPersonId: holder?.id,
        reference,
        billingStartPeriod: billingStart ?? undefined,
      },
    });
    if (!parsed.success) {
      const next: Partial<Record<Field, string>> = {};
      for (const issue of parsed.error.issues) {
        const field = String(issue.path.at(-1)) as Field;
        next[field] ??=
          field === 'billingStartPeriod'
            ? 'Elija el primer mes pendiente.'
            : field === 'activatedOn'
              ? 'Escriba la fecha como AAAA-MM-DD.'
              : issue.message;
      }
      setErrors(next);
      return;
    }
    setErrors({});
    create.mutate(parsed.data, {
      onSuccess: ({ connection }) =>
        guard.leave(() => router.replace(`/common/connections/${connection.id}`)),
    });
  };

  return (
    <ScreenLayout
      footer={<Button label="Guardar familia" onPress={submit} loading={create.isPending} />}
    >
      <Header
        title="Familia que ya existía"
        subtitle="Captura inicial desde la libreta"
        onBack={() => router.back()}
      />

      <TextField
        label="Dirección de la toma"
        required
        value={address}
        onChangeText={setAddress}
        example="Calle Pino 12"
        error={errorOf('address')}
        maxLength={200}
      />
      <BlockField value={blockId} onChange={setBlockId} error={errorOf('blockId')} />
      <PersonPicker
        label="Titular"
        value={holder}
        onChange={setHolder}
        text={search}
        onChangeText={setSearch}
        error={errorOf('holderPersonId')}
      />
      <TextField
        label="Referencia de la familia"
        value={reference}
        onChangeText={setReference}
        help="Opcional, para distinguirla en la misma toma."
        error={errorOf('reference')}
        maxLength={80}
      />
      <TextField
        label="Fecha de activación"
        value={activatedOn}
        onChangeText={setActivatedOn}
        example="2019-01-15"
        help="AAAA-MM-DD. Opcional: si no la sabe, déjela vacía."
        error={errorOf('activatedOn')}
        maxLength={10}
      />
      <Select
        label="Primer mes pendiente según la libreta"
        required
        options={monthOptions(addMonths(now, -LEDGER_MONTHS), now)}
        value={billingStart}
        onChange={setBillingStart}
        placeholder="Elija el mes"
        error={errorOf('billingStartPeriod')}
      />

      {estimate ? (
        <Notice
          icon="alert"
          title={`Estimación: ${estimate.text}`}
          detail={
            estimate.missingRates > 0
              ? 'Hay meses sin tarifa autorizada que no se pudieron calcular. Compárelo con la libreta.'
              : 'Compárelo con la libreta antes de guardar.'
          }
        />
      ) : rates.isError ? (
        <Notice title="No se pudo calcular la estimación del adeudo." />
      ) : null}

      {general ? <Notice title={general} /> : null}
      <AppText variant="caption" color={colors.textSecondary}>
        La toma queda activa y la familia se cobra desde el primer mes pendiente.
      </AppText>
      <DiscardChangesSheet guard={guard} />
    </ScreenLayout>
  );
}
