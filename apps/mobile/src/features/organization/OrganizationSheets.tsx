import {
  type Block,
  createBlockRequestSchema,
  createSectionRequestSchema,
  type Section,
} from '@bella-vista/shared';
import { useState } from 'react';
import { describeSaveError, fieldErrors } from '../../api/error-messages.js';
import { isApiError } from '../../api/errors.js';
import { useCreateBlock, useCreateSection } from '../../api/useOrganization.js';
import {
  AppText,
  BottomSheet,
  Button,
  colors,
  DataRow,
  Notice,
  Select,
  TextField,
} from '../../ui/index.js';
import type { BlockView } from './organization-view.js';

// S-06: "Nueva sección", "Nueva manzana" and the data of a block, in bottom sheets so the
// organization stays on screen (3.2 §10.7). The code never changes once created; with the
// section it forms the visible code (S1-M03). Validation uses the API's own schemas. The
// screen mounts each sheet only while it is open, so every opening starts empty.

type Errors = Partial<Record<'sectionId' | 'code' | 'name', string>>;

const firstIssues = (issues: readonly { path: PropertyKey[]; message: string }[]): Errors => {
  const result: Errors = {};
  for (const issue of issues) {
    const key = String(issue.path[0]) as keyof Errors;
    result[key] ??= issue.message;
  }
  return result;
};

/** API errors on the form's fields: DUPLICATE_CODE names its field; Zod issues their path. */
function serverErrors(error: unknown): { fields: Errors; general: string | null } {
  if (!error) return { fields: {}, general: null };
  if (isApiError(error) && error.code === 'DUPLICATE_CODE') {
    const field = error.details.field === 'name' ? 'name' : 'code';
    return { fields: { [field]: error.message }, general: null };
  }
  const fields = fieldErrors(error) as Errors;
  return Object.keys(fields).length > 0
    ? { fields, general: null }
    : { fields: {}, general: describeSaveError(error).message };
}

export function NewSectionSheet({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (section: Section) => void;
}) {
  const create = useCreateSection();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [errors, setErrors] = useState<Errors>({});

  const server = serverErrors(create.error);
  const submit = () => {
    const parsed = createSectionRequestSchema.safeParse({ code, name });
    if (!parsed.success) {
      setErrors(firstIssues(parsed.error.issues));
      return;
    }
    setErrors({});
    create.mutate(parsed.data, { onSuccess: ({ section }) => onCreated(section) });
  };

  return (
    <BottomSheet
      visible
      title="Nueva sección"
      onClose={create.isPending ? () => undefined : onClose}
      footer={
        <>
          <Button label="Registrar sección" onPress={submit} loading={create.isPending} />
          <Button label="Volver" variant="secondary" onPress={onClose} />
        </>
      }
    >
      <TextField
        label="Clave"
        required
        value={code}
        onChangeText={setCode}
        autoCapitalize="characters"
        example="S3"
        help="La clave no cambia después."
        error={errors.code ?? server.fields.code ?? null}
        maxLength={10}
      />
      <TextField
        label="Nombre"
        required
        value={name}
        onChangeText={setName}
        example="Sección Norte"
        error={errors.name ?? server.fields.name ?? null}
        maxLength={80}
      />
      {server.general ? <Notice title={server.general} /> : null}
    </BottomSheet>
  );
}

export function NewBlockSheet({
  sections,
  onClose,
  onCreated,
}: {
  sections: readonly Section[];
  onClose: () => void;
  onCreated: (block: Block) => void;
}) {
  const create = useCreateBlock();
  const active = sections.filter((section) => section.active);
  const [sectionId, setSectionId] = useState<number | null>(
    active.length === 1 ? (active[0]?.id ?? null) : null,
  );
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [errors, setErrors] = useState<Errors>({});

  const server = serverErrors(create.error);
  const submit = () => {
    const parsed = createBlockRequestSchema.safeParse({
      sectionId: sectionId ?? undefined,
      code,
      name: name.trim() === '' ? null : name,
    });
    if (!parsed.success) {
      setErrors(firstIssues(parsed.error.issues));
      return;
    }
    setErrors({});
    create.mutate(parsed.data, { onSuccess: ({ block }) => onCreated(block) });
  };

  return (
    <BottomSheet
      visible
      title="Nueva manzana"
      onClose={create.isPending ? () => undefined : onClose}
      footer={
        <>
          <Button label="Registrar manzana" onPress={submit} loading={create.isPending} />
          <Button label="Volver" variant="secondary" onPress={onClose} />
        </>
      }
    >
      <Select
        label="Sección"
        required
        options={active.map((section) => ({
          value: section.id,
          label: `${section.code} · ${section.name}`,
        }))}
        value={sectionId}
        onChange={setSectionId}
        placeholder="Elija la sección"
        error={errors.sectionId ?? null}
      />
      <TextField
        label="Clave de la manzana"
        required
        value={code}
        onChangeText={setCode}
        autoCapitalize="characters"
        example="M03"
        help="Con la sección forma la clave visible (S1-M03) y no cambia después."
        error={errors.code ?? server.fields.code ?? null}
        maxLength={10}
      />
      <TextField
        label="Nombre o referencia"
        value={name}
        onChangeText={setName}
        example="Frente a la escuela"
        error={errors.name ?? server.fields.name ?? null}
        maxLength={80}
      />
      <AppText variant="caption" color={colors.textSecondary}>
        Cada manzana nueva nace con su caja. Después asigne a su jefe en «Cargos y jefes».
      </AppText>
      {server.general ? <Notice title={server.general} /> : null}
    </BottomSheet>
  );
}

/** The data of one block and what can be done with its leader. */
export function BlockSheet({
  view,
  onClose,
  onAssign,
  onSubstitute,
}: {
  view: BlockView | null;
  onClose: () => void;
  onAssign: (block: Block) => void;
  onSubstitute: (block: Block) => void;
}) {
  if (!view) return null;
  const { block, pending } = view;
  const canAssign = block.active && !block.leader && !pending;
  const canSubstitute = block.leader !== null && !pending;
  return (
    <BottomSheet
      visible
      title={`Manzana ${block.fullCode}`}
      onClose={onClose}
      footer={
        <>
          {canAssign ? <Button label="Asignar jefe" onPress={() => onAssign(block)} /> : null}
          {canSubstitute ? (
            <Button label="Sustituir jefe" onPress={() => onSubstitute(block)} />
          ) : null}
          <Button label="Volver" variant="secondary" onPress={onClose} />
        </>
      }
    >
      {block.name ? <DataRow label="Nombre" value={block.name} /> : null}
      <DataRow label="Estado" value={block.active ? 'Activa' : 'Inactiva'} />
      <DataRow label="Jefe de manzana" value={block.leader?.fullName ?? 'Sin jefe asignado'} />
      {block.leader?.contactPhone ? (
        <DataRow label="Teléfono" value={block.leader.contactPhone} />
      ) : null}
      {pending ? (
        <Notice
          icon="info"
          title={`${pending.person.fullName} espera la autorización del presidente.`}
        />
      ) : null}
    </BottomSheet>
  );
}
