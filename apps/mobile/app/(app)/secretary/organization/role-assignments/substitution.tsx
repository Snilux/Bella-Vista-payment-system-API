// S-07 · Cargos y jefes (Sustituir jefe)
import { formatDate, leaderSubstitutionRequestSchema, type PersonBasic } from '@bella-vista/shared';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import {
  describeError,
  fieldErrors,
  SUBSTITUTION_MESSAGES,
} from '../../../../../src/api/error-messages.js';
import { useBlockExtraordinaryClosings } from '../../../../../src/api/useClosings.js';
import {
  useBlocks,
  useLeaderSubstitution,
  useRoleAssignments,
} from '../../../../../src/api/useOrganization.js';
import { businessToday } from '../../../../../src/features/forms/business-date.js';
import {
  DiscardChangesSheet,
  useDiscardGuard,
} from '../../../../../src/features/forms/DiscardChangesSheet.js';
import { isPending } from '../../../../../src/features/organization/organization-view.js';
import { PersonPicker } from '../../../../../src/features/people/PersonPicker.js';
import {
  AppText,
  Button,
  colors,
  DataRow,
  Header,
  Notice,
  ScreenLayout,
  Select,
  SuccessScreen,
  SummaryCard,
  TextField,
} from '../../../../../src/ui/index.js';

// "Sustituir jefe" (S-07; 3.2 §10.7; D-08). The handover record is an extraordinary closing of
// the block's cashbox with the cash counted (the outgoing leader or the treasurer makes it; the
// closing screens arrive in M8). Without it the screen says what is missing before sending,
// with the same text the app gives to the API's INVALID_STATE (error-messages.ts). Sending ends
// the outgoing leader at once (their account is deactivated) and leaves the new one pending
// the president's approval; the cashbox stays with the block and its balance.

type Field = 'closingId' | 'personId' | 'contactPhone' | 'startDate' | 'reason';

export default function SubstituteLeader() {
  const params = useLocalSearchParams<{ blockId?: string }>();
  const blocks = useBlocks();
  const assignments = useRoleAssignments();
  const substitute = useLeaderSubstitution();

  const [blockId, setBlockId] = useState<number | null>(
    params.blockId ? Number(params.blockId) : null,
  );
  const [closingId, setClosingId] = useState<number | null>(null);
  const [person, setPerson] = useState<PersonBasic | null>(null);
  const [search, setSearch] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [startDate, setStartDate] = useState(businessToday());
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});

  // Blocks with a current leader and no substitution already waiting for the president.
  const pendingBlocks = new Set(
    (assignments.data ?? [])
      .filter((item) => isPending(item) && item.role === 'block_leader')
      .map((item) => item.blockId),
  );
  const withLeader = (blocks.data ?? []).filter(
    (block) => block.leader !== null && !pendingBlocks.has(block.id),
  );
  const block = withLeader.find((item) => item.id === blockId) ?? null;
  const closings = useBlockExtraordinaryClosings(block);
  const counted = (closings.data ?? []).filter((closing) => closing.status !== 'draft');
  const closing = counted.find((item) => item.id === closingId) ?? counted[0] ?? null;

  const dirty = person !== null || contactPhone !== '' || reason !== '';
  const guard = useDiscardGuard(dirty && !substitute.isSuccess);

  if (substitute.isSuccess) {
    const { outgoing, incoming } = substitute.data;
    return (
      <SuccessScreen
        title="Enviada al presidente"
        message={`${outgoing.person.fullName} dejó el cargo y su cuenta se desactivó. ${incoming.person.fullName} queda como jefe de ${incoming.blockCode ?? 'la manzana'} cuando el presidente lo autorice.`}
        onDone={() => router.back()}
        doneLabel="Volver a cargos y jefes"
      />
    );
  }

  // What blocks the substitution before sending (none while the closings load).
  const missing =
    block === null || !closings.isSuccess || closing !== null
      ? null
      : (closings.data ?? []).length > 0
        ? SUBSTITUTION_MESSAGES.notCounted
        : SUBSTITUTION_MESSAGES.noClosing;

  const server = substitute.isError ? fieldErrors(substitute.error) : {};
  const general =
    substitute.isError && Object.keys(server).length === 0
      ? describeError(substitute.error).message
      : null;
  const errorOf = (field: Field) => errors[field] ?? server[field] ?? null;

  const submit = () => {
    if (!block || !closing) return;
    const parsed = leaderSubstitutionRequestSchema.safeParse({
      closingId: closing.id,
      personId: person?.id,
      contactPhone,
      startDate,
      reason,
    });
    if (!parsed.success) {
      const next: Partial<Record<Field, string>> = {};
      for (const issue of parsed.error.issues) {
        const field = String(issue.path[0]) as Field;
        next[field] ??= field === 'startDate' ? 'Escriba la fecha como AAAA-MM-DD.' : issue.message;
      }
      setErrors(next);
      return;
    }
    setErrors({});
    substitute.mutate(
      { block, body: parsed.data },
      // INVALID_STATE: the record changed (counted again, new movements): reload it.
      { onError: () => void closings.refetch() },
    );
  };

  return (
    <ScreenLayout
      footer={
        <Button
          label="Enviar al presidente"
          onPress={submit}
          loading={substitute.isPending}
          disabledReason={
            block === null
              ? 'Elija la manzana.'
              : missing
                ? 'Falta el corte extraordinario contado.'
                : closing === null
                  ? 'Espere a que cargue el corte.'
                  : null
          }
        />
      }
    >
      <Header title="Sustituir jefe" onBack={() => router.back()} />

      <Select
        label="Manzana"
        required
        options={withLeader.map((item) => ({
          value: item.id,
          label: item.fullCode,
          description: `Jefe de manzana: ${item.leader?.fullName ?? ''}`,
        }))}
        value={block?.id ?? null}
        onChange={(value) => {
          setBlockId(value);
          setClosingId(null);
          setPerson(null);
        }}
        placeholder="Elija la manzana"
        help="Solo aparecen las manzanas con jefe vigente."
      />

      {block ? (
        <SummaryCard tone="plain">
          <DataRow label="Jefe saliente" value={block.leader?.fullName ?? ''} />
          {closing ? (
            <DataRow
              label="Acta de entrega"
              value={`Corte ${closing.folio} del ${formatDate(closing.dateTo)}`}
            />
          ) : null}
        </SummaryCard>
      ) : null}

      {missing ? <Notice title={missing} /> : null}
      {closings.isError ? <Notice title={describeError(closings.error).message} /> : null}

      {block && counted.length > 1 ? (
        <Select
          label="Acta de entrega"
          required
          options={counted.map((item) => ({
            value: item.id,
            label: `${item.folio} · ${formatDate(item.dateTo)}`,
          }))}
          value={closing?.id ?? null}
          onChange={setClosingId}
          help="El corte extraordinario contado de la caja de esta manzana."
          error={errorOf('closingId')}
        />
      ) : null}

      {block && closing ? (
        <>
          <PersonPicker
            label="Nuevo jefe de manzana"
            value={person}
            onChange={setPerson}
            text={search}
            onChangeText={setSearch}
            error={errorOf('personId')}
            exclude={{
              ids: block.leader ? [block.leader.personId] : [],
              reason: 'Es el jefe saliente.',
            }}
          />
          <TextField
            label="Teléfono de contacto"
            required
            value={contactPhone}
            onChangeText={setContactPhone}
            keyboardType="phone-pad"
            example="222 111 2233"
            error={errorOf('contactPhone')}
            maxLength={20}
          />
          <TextField
            label="Fecha de inicio"
            required
            value={startDate}
            onChangeText={setStartDate}
            example="2026-11-18"
            help="AAAA-MM-DD. No antes del acta de entrega ni después de hoy."
            error={errorOf('startDate')}
            maxLength={10}
          />
          <TextField
            label="Motivo"
            required
            value={reason}
            onChangeText={setReason}
            help="El presidente lo leerá al autorizar."
            error={errorOf('reason')}
            maxLength={500}
            multiline
          />
        </>
      ) : null}

      {general ? <Notice title={general} /> : null}
      <AppText variant="caption" color={colors.textSecondary}>
        Al enviar, el jefe saliente deja el cargo y su cuenta se desactiva. La caja sigue con la
        manzana y su saldo.
      </AppText>
      <DiscardChangesSheet guard={guard} />
    </ScreenLayout>
  );
}
