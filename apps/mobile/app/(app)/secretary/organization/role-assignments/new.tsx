// S-07 · Cargos y jefes (Asignar cargo)
import {
  ASSIGNABLE_ROLES,
  type AssignableRole,
  createRoleAssignmentSchema,
  type PersonBasic,
} from '@bella-vista/shared';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { describeError, fieldErrors } from '../../../../../src/api/error-messages.js';
import {
  useAssignRole,
  useBlocks,
  useRoleAssignments,
} from '../../../../../src/api/useOrganization.js';
import { businessToday } from '../../../../../src/features/forms/business-date.js';
import {
  DiscardChangesSheet,
  useDiscardGuard,
} from '../../../../../src/features/forms/DiscardChangesSheet.js';
import { isPending } from '../../../../../src/features/organization/organization-view.js';
import { PersonPicker } from '../../../../../src/features/people/PersonPicker.js';
import { ROLE_LABELS } from '../../../../../src/session/role-labels.js';
import {
  AppText,
  Button,
  colors,
  DATE_FORMAT_MESSAGE,
  DateField,
  Header,
  Notice,
  ScreenLayout,
  Select,
  SuccessScreen,
  TextField,
} from '../../../../../src/ui/index.js';

// "Asignar cargo" (S-07; 3.2 §10.7; D-09, D-22): a committee role (president, treasurer,
// secretary, member) or the leader of a block without one. It is registered pending: the
// president authorizes it in R-03, and then the superadmin creates its account. A block leader
// needs a block and a contact phone; the rules and messages are those of the API's schema.

type Field = 'role' | 'blockId' | 'personId' | 'contactPhone' | 'startDate' | 'reason';

const isAssignable = (value: unknown): value is AssignableRole =>
  typeof value === 'string' && (ASSIGNABLE_ROLES as readonly string[]).includes(value);

export default function AssignRole() {
  const params = useLocalSearchParams<{ role?: string; blockId?: string }>();
  const blocks = useBlocks();
  const assignments = useRoleAssignments();
  const assign = useAssignRole();

  const [role, setRole] = useState<AssignableRole>(
    isAssignable(params.role) ? params.role : 'block_leader',
  );
  const [blockId, setBlockId] = useState<number | null>(
    params.blockId ? Number(params.blockId) : null,
  );
  const [person, setPerson] = useState<PersonBasic | null>(null);
  const [search, setSearch] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [startDate, setStartDate] = useState(businessToday());
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});

  const dirty = person !== null || contactPhone !== '' || reason !== '';
  const guard = useDiscardGuard(dirty && !assign.isSuccess);

  if (assign.isSuccess) {
    const { assignment } = assign.data;
    return (
      <SuccessScreen
        title="Enviada al presidente"
        message={`${assignment.person.fullName} queda como ${ROLE_LABELS[assignment.role].toLowerCase()}${assignment.blockCode ? ` de ${assignment.blockCode}` : ''} cuando el presidente lo autorice.`}
        onDone={() => router.back()}
        doneLabel="Volver a cargos y jefes"
      />
    );
  }

  // Blocks that can receive a leader: active, without leader and without a pending request.
  const pendingBlocks = new Set(
    (assignments.data ?? [])
      .filter((item) => isPending(item) && item.role === 'block_leader')
      .map((item) => item.blockId),
  );
  const freeBlocks = (blocks.data ?? []).filter(
    (block) => block.active && block.leader === null && !pendingBlocks.has(block.id),
  );
  const leader = role === 'block_leader';
  const server = assign.isError ? fieldErrors(assign.error) : {};
  const general =
    assign.isError && Object.keys(server).length === 0 ? describeError(assign.error).message : null;
  const errorOf = (field: Field) => errors[field] ?? server[field] ?? null;

  const submit = () => {
    const parsed = createRoleAssignmentSchema.safeParse({
      personId: person?.id,
      role,
      blockId: leader ? blockId : null,
      contactPhone: contactPhone.trim() === '' ? null : contactPhone,
      startDate,
      reason: reason.trim() === '' ? undefined : reason,
    });
    if (!parsed.success) {
      const next: Partial<Record<Field, string>> = {};
      for (const issue of parsed.error.issues) {
        const field = String(issue.path[0]) as Field;
        next[field] ??=
          field === 'personId'
            ? 'Elija a la persona.'
            : field === 'startDate'
              ? DATE_FORMAT_MESSAGE
              : issue.message;
      }
      setErrors(next);
      return;
    }
    setErrors({});
    assign.mutate(parsed.data);
  };

  return (
    <ScreenLayout
      footer={<Button label="Enviar al presidente" onPress={submit} loading={assign.isPending} />}
    >
      <Header title="Asignar cargo" onBack={() => router.back()} />

      <Select
        label="Cargo"
        required
        options={ASSIGNABLE_ROLES.map((value) => ({ value, label: ROLE_LABELS[value] }))}
        value={role}
        onChange={(value) => {
          setRole(value);
          setErrors({});
        }}
        error={errorOf('role')}
      />

      {leader ? (
        freeBlocks.length === 0 && blocks.isSuccess ? (
          <Notice
            icon="info"
            title="Todas las manzanas activas tienen jefe o una asignación por confirmar."
            detail="Para cambiar a un jefe use «Sustituir jefe»."
          />
        ) : (
          <Select
            label="Manzana"
            required
            options={freeBlocks.map((block) => ({
              value: block.id,
              label: block.fullCode,
              ...(block.name ? { description: block.name } : {}),
            }))}
            value={blockId}
            onChange={setBlockId}
            placeholder="Elija la manzana"
            help="Solo aparecen las manzanas sin jefe."
            error={errorOf('blockId')}
          />
        )
      ) : null}

      <PersonPicker
        label="Persona"
        value={person}
        onChange={setPerson}
        text={search}
        onChangeText={setSearch}
        error={errorOf('personId')}
      />

      <TextField
        label="Teléfono de contacto"
        required={leader}
        value={contactPhone}
        onChangeText={setContactPhone}
        keyboardType="phone-pad"
        example="222 111 2233"
        help={leader ? 'Lo ven el comité y el propio jefe.' : null}
        error={errorOf('contactPhone')}
        maxLength={20}
      />
      <DateField
        label="Fecha de inicio"
        required
        value={startDate}
        onChange={setStartDate}
        help="Si es posterior a hoy, el cargo queda programado."
        error={errorOf('startDate')}
      />
      <TextField
        label="Motivo o acuerdo"
        value={reason}
        onChangeText={setReason}
        help="El presidente lo leerá al autorizar."
        error={errorOf('reason')}
        maxLength={500}
        multiline
      />

      {general ? <Notice title={general} /> : null}
      <AppText variant="caption" color={colors.textSecondary}>
        La asignación queda pendiente hasta que el presidente la autorice.
      </AppText>
      <DiscardChangesSheet guard={guard} />
    </ScreenLayout>
  );
}
