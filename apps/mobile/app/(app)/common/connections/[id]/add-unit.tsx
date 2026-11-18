// P-04 · Agregar familia a toma
import {
  createUnitRequestSchema,
  formatPeriod,
  type PersonBasic,
  periodOfDate,
} from '@bella-vista/shared';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { describeError, fieldErrors } from '../../../../../src/api/error-messages.js';
import { useConnection, useCreateUnit } from '../../../../../src/api/useRegistry.js';
import { businessToday } from '../../../../../src/features/forms/business-date.js';
import {
  DiscardChangesSheet,
  useDiscardGuard,
} from '../../../../../src/features/forms/DiscardChangesSheet.js';
import { PersonPicker } from '../../../../../src/features/people/PersonPicker.js';
import {
  Button,
  DATE_FORMAT_MESSAGE,
  DateField,
  Header,
  Notice,
  ScreenLayout,
  TextField,
} from '../../../../../src/ui/index.js';

// A new family in an active connection (Figma P-04; 3.2 §10.4): holder, reference and the
// registration date. No opening fee: the family pays its monthly fee from that month, in full.
// A suspended or deactivated connection → CONNECTION_NOT_ACTIVE (G-03 does not offer it then).

type Field = 'holderPersonId' | 'reference' | 'registeredOn';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export default function AddUnit() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const connectionId = Number(id);
  const connection = useConnection(connectionId);
  const create = useCreateUnit();
  const [holder, setHolder] = useState<PersonBasic | null>(null);
  const [search, setSearch] = useState('');
  const [reference, setReference] = useState('');
  const [registeredOn, setRegisteredOn] = useState(businessToday());
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const guard = useDiscardGuard((holder !== null || reference !== '') && !create.isSuccess);

  const server = create.isError ? fieldErrors(create.error) : {};
  const general =
    create.isError && Object.keys(server).length === 0 ? describeError(create.error).message : null;
  const errorOf = (field: Field) => errors[field] ?? server[field] ?? null;
  const firstMonth = DATE.test(registeredOn) ? formatPeriod(periodOfDate(registeredOn)) : null;

  const submit = () => {
    const parsed = createUnitRequestSchema.safeParse({
      connectionId,
      holderPersonId: holder?.id,
      reference,
      registeredOn: registeredOn.trim(),
    });
    if (!parsed.success) {
      const next: Partial<Record<Field, string>> = {};
      for (const issue of parsed.error.issues) {
        const field = String(issue.path[0]) as Field;
        next[field] ??= field === 'registeredOn' ? DATE_FORMAT_MESSAGE : issue.message;
      }
      setErrors(next);
      return;
    }
    setErrors({});
    create.mutate(parsed.data, { onSuccess: () => guard.leave(() => router.back()) });
  };

  const data = connection.data;
  return (
    <ScreenLayout
      footer={<Button label="Agregar familia" onPress={submit} loading={create.isPending} />}
    >
      <Header
        title="Agregar familia"
        {...(data ? { subtitle: `Toma ${data.folio} · ${data.address}` } : {})}
        onBack={() => router.back()}
      />
      <PersonPicker
        label="Titular"
        value={holder}
        onChange={setHolder}
        text={search}
        onChangeText={setSearch}
        error={errorOf('holderPersonId')}
      />
      <TextField
        label="Referencia"
        value={reference}
        onChangeText={setReference}
        example="Familia de atrás"
        help="Opcional, para distinguirla en la misma toma."
        error={errorOf('reference')}
        maxLength={80}
      />
      <DateField
        label="Fecha de activación"
        required
        value={registeredOn}
        onChange={setRegisteredOn}
        error={errorOf('registeredOn')}
      />
      <Notice
        icon="alert"
        title={
          firstMonth
            ? `No se cobra apertura. Pagará completo ${firstMonth.toLowerCase()}, su mes de activación.`
            : 'No se cobra apertura. Pagará completo su mes de activación.'
        }
      />
      {general ? <Notice title={general} /> : null}
      <DiscardChangesSheet guard={guard} />
    </ScreenLayout>
  );
}
