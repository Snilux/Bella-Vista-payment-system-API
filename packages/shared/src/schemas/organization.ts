import { z } from 'zod';
import { ROLES } from '../domain/role-assignment.js';

// Organization endpoints (/v1/sections, /v1/blocks, /v1/role-assignments; CU-03, CU-04,
// RF-ORG). Codes are immutable once created: they form the visible block code (S1-M03).

const code = (field: string, example: string) =>
  z
    .string({ error: `${field} es obligatoria.` })
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{1,10}$/, {
      error: `${field} debe tener de 1 a 10 letras o números (ej. ${example}).`,
    });

const name = z
  .string({ error: 'El nombre es obligatorio.' })
  .trim()
  .min(1, { error: 'El nombre no puede estar vacío.' })
  .max(80, { error: 'El nombre no puede tener más de 80 caracteres.' });

const atLeastOneField = (body: Record<string, unknown>) =>
  Object.values(body).some((value) => value !== undefined);
const nothingToChange = { error: 'Indica al menos un dato que cambiar.' };

export const idParamsSchema = z.object({ id: z.coerce.number().int().positive() });

// --- Sections -------------------------------------------------------------------------------

export const sectionSchema = z.object({
  id: z.int(),
  code: z.string(),
  name: z.string(),
  active: z.boolean(),
});

export const createSectionRequestSchema = z.object({ code: code('La clave', 'S1'), name });

export const updateSectionRequestSchema = z
  .object({ name: name.optional(), active: z.boolean().optional() })
  .refine(atLeastOneField, nothingToChange);

export const sectionListResponseSchema = z.object({ sections: z.array(sectionSchema) });
export const sectionResponseSchema = z.object({ section: sectionSchema });

// --- Blocks ---------------------------------------------------------------------------------

export const blockLeaderSchema = z.object({
  personId: z.int(),
  fullName: z.string(),
  /** Only the committee and the block's own leader see it (RF-ORG-06); null otherwise. */
  contactPhone: z.string().nullable(),
});

export const blockSchema = z.object({
  id: z.int(),
  sectionId: z.int(),
  /** Block code inside its section (M03). */
  code: z.string(),
  /** Visible code: section code + block code (S1-M03). */
  fullCode: z.string(),
  name: z.string().nullable(),
  active: z.boolean(),
  /** Current, approved block leader (null when the block has none). */
  leader: blockLeaderSchema.nullable(),
});

export const blockListQuerySchema = z.object({
  sectionId: z.coerce.number().int().positive().optional(),
});

export const createBlockRequestSchema = z.object({
  sectionId: z.int({ error: 'Elige la sección.' }).positive(),
  code: code('La clave', 'M03'),
  name: name.nullish().transform((value) => value ?? null),
});

export const updateBlockRequestSchema = z
  .object({ name: name.nullable().optional(), active: z.boolean().optional() })
  .refine(atLeastOneField, nothingToChange);

export const blockListResponseSchema = z.object({ blocks: z.array(blockSchema) });
export const blockResponseSchema = z.object({ block: blockSchema });

// --- Role assignments -----------------------------------------------------------------------

/**
 * Derived status of an assignment: pending (approval unresolved), rejected, scheduled
 * (approved, starts later), active, or closed (approved, ended before today).
 */
export const ASSIGNMENT_STATUSES = [
  'pending',
  'rejected',
  'scheduled',
  'active',
  'closed',
] as const;

export type AssignmentStatus = (typeof ASSIGNMENT_STATUSES)[number];

export const roleAssignmentSchema = z.object({
  id: z.int(),
  role: z.enum(ROLES),
  status: z.enum(ASSIGNMENT_STATUSES),
  person: z.object({
    id: z.int(),
    folio: z.string(),
    fullName: z.string(),
    distinguishingNote: z.string().nullable(),
  }),
  blockId: z.int().nullable(),
  blockCode: z.string().nullable(),
  contactPhone: z.string().nullable(),
  startDate: z.iso.date(),
  endDate: z.iso.date().nullable(),
  approvalId: z.int().nullable(),
  /** Whether the assignment already has an account (created by the superadmin). */
  hasAccount: z.boolean(),
});

export const roleAssignmentListQuerySchema = z.object({
  status: z.enum(ASSIGNMENT_STATUSES).optional(),
  role: z.enum(ROLES).optional(),
  blockId: z.coerce.number().int().positive().optional(),
});

export const roleAssignmentListResponseSchema = z.object({
  assignments: z.array(roleAssignmentSchema),
});

export const roleAssignmentResponseSchema = z.object({ assignment: roleAssignmentSchema });

/** End of term of a committee officer (D-22: the account is deactivated with it). */
export const closeRoleAssignmentRequestSchema = z.object({
  endDate: z.iso.date({ error: 'La fecha de fin debe tener el formato AAAA-MM-DD.' }),
  reason: z
    .string({ error: 'Escribe el motivo.' })
    .trim()
    .min(1, { error: 'Escribe el motivo.' })
    .max(500, { error: 'El motivo no puede tener más de 500 caracteres.' }),
});

export type Section = z.infer<typeof sectionSchema>;
export type CreateSectionRequest = z.infer<typeof createSectionRequestSchema>;
export type UpdateSectionRequest = z.infer<typeof updateSectionRequestSchema>;
export type Block = z.infer<typeof blockSchema>;
export type CreateBlockRequest = z.infer<typeof createBlockRequestSchema>;
export type UpdateBlockRequest = z.infer<typeof updateBlockRequestSchema>;
export type RoleAssignment = z.infer<typeof roleAssignmentSchema>;
export type RoleAssignmentListQuery = z.infer<typeof roleAssignmentListQuerySchema>;
export type CloseRoleAssignmentRequest = z.infer<typeof closeRoleAssignmentRequestSchema>;
