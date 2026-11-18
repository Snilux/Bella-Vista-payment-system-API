// P-05 · Nueva solicitud de toma
import {
  createConnectionRequestRequestSchema,
  formatMoney,
  type PersonBasic,
} from '@bella-vista/shared';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { describeSaveError, fieldErrors } from '../../../../src/api/error-messages.js';
import {
  useCreateConnectionRequest,
  useOpeningFee,
} from '../../../../src/api/useConnectionRequests.js';
import { businessToday } from '../../../../src/features/forms/business-date.js';
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
  Button,
  DATE_FORMAT_MESSAGE,
  DataRow,
  DateField,
  Header,
  Notice,
  ScreenLayout,
  SuccessScreen,
  TextField,
} from '../../../../src/ui/index.js';

// A request for a new connection (Figma P-05; 3.2 §10.4; D-12, D-13): applicant, address, block
// and date. The committee decides in a meeting (S-03); if approved, the opening fee in force that
// day is charged, so the screen shows today's amount. A block leader requests in their block.

type Field = 'applicantId' | 'address' | 'blockId' | 'requestedOn';

export default function NewConnectionRequest() {
  const params = useLocalSearchParams<PersonParams>();
  const fixedBlock = useFixedBlock();
  const opening = useOpeningFee();
  const create = useCreateConnectionRequest();
  const [applicant, setApplicant] = useState<PersonBasic | null>(personFromParams(params));
  const [search, setSearch] = useState('');
  const [address, setAddress] = useState('');
  const [blockId, setBlockId] = useState<number | null>(fixedBlock);
  const [requestedOn, setRequestedOn] = useState(businessToday());
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const guard = useDiscardGuard(address !== '' && !create.isSuccess);

  if (create.isSuccess) {
    const { request } = create.data;
    return (
      <SuccessScreen
        title="Solicitud registrada"
        message="El comité la revisará en junta."
        onDone={() => router.back()}
        doneLabel="Listo"
      >
        <DataRow label="Solicitud" value={request.folio} />
        <DataRow label="Solicitante" value={request.applicant.fullName} />
        <DataRow label="Dirección" value={`${request.address} · ${request.blockCode}`} />
      </SuccessScreen>
    );
  }

  const server = create.isError ? fieldErrors(create.error) : {};
  const general =
    create.isError && Object.keys(server).length === 0
      ? describeSaveError(create.error).message
      : null;
  const errorOf = (field: Field) => errors[field] ?? server[field] ?? null;
  const amount = opening.data?.currentAmount?.amount ?? null;

  const submit = () => {
    const parsed = createConnectionRequestRequestSchema.safeParse({
      applicantId: applicant?.id,
      address,
      blockId: blockId ?? undefined,
      requestedOn: requestedOn.trim(),
    });
    if (!parsed.success) {
      const next: Partial<Record<Field, string>> = {};
      for (const issue of parsed.error.issues) {
        const field = String(issue.path[0]) as Field;
        next[field] ??= field === 'requestedOn' ? DATE_FORMAT_MESSAGE : issue.message;
      }
      setErrors(next);
      return;
    }
    setErrors({});
    create.mutate(parsed.data);
  };

  return (
    <ScreenLayout
      footer={<Button label="Registrar solicitud" onPress={submit} loading={create.isPending} />}
    >
      <Header title="Nueva solicitud de toma" onBack={() => router.back()} />
      <PersonPicker
        label="Solicitante"
        value={applicant}
        onChange={setApplicant}
        text={search}
        onChangeText={setSearch}
        error={errorOf('applicantId')}
      />
      <TextField
        label="Dirección solicitada"
        required
        value={address}
        onChangeText={setAddress}
        example="Calle Encino 8"
        error={errorOf('address')}
        maxLength={200}
      />
      <BlockField value={blockId} onChange={setBlockId} error={errorOf('blockId')} />
      <DateField
        label="Fecha de solicitud"
        required
        value={requestedOn}
        onChange={setRequestedOn}
        error={errorOf('requestedOn')}
      />
      <Notice
        icon="alert"
        title={
          amount === null
            ? 'El comité la revisará en junta. Si se aprueba, se cobrará la apertura vigente.'
            : `El comité la revisará en junta. Si se aprueba, se cobrará la apertura vigente: ${formatMoney(amount)}.`
        }
        {...(opening.isSuccess && amount === null
          ? {
              detail:
                'La apertura aún no tiene importe: el tesorero debe registrarlo antes de aprobarla.',
            }
          : {})}
      />
      {general ? <Notice title={general} /> : null}
      <DiscardChangesSheet guard={guard} />
    </ScreenLayout>
  );
}
