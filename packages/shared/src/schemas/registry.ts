import { z } from 'zod';
import { debtSummarySchema } from './billing.js';
import { optionalText, periodSchema, personBasicSchema, requiredText } from './common.js';

// Registry endpoints (/v1/search, /v1/people, /v1/units, /v1/suspensions; CU-05 to CU-07,
// CU-10, CU-11, RF-PAD). A block leader sees payment data of their block only; of people
// outside it, only name, distinguishing note and folio (RF-PAD-04, HU-13).

export const UNIT_STATUSES = ['pending_activation', 'active', 'suspended', 'deactivated'] as const;
export const CONNECTION_STATUSES = ['active', 'suspended', 'deactivated'] as const;

// --- Search ---------------------------------------------------------------------------------

export const searchQuerySchema = z.object({
  q: z
    .string({ error: 'Escribe qué buscar.' })
    .trim()
    .min(2, { error: 'Escribe al menos 2 caracteres.' })
    .max(100, { error: 'La búsqueda es demasiado larga.' }),
});

export const searchConnectionSchema = z.object({
  id: z.int(),
  folio: z.string(),
  address: z.string(),
  blockCode: z.string().nullable(),
  status: z.enum(CONNECTION_STATUSES),
  unitCount: z.int(),
});

export const searchUnitSchema = z.object({
  id: z.int(),
  folio: z.string(),
  reference: z.string().nullable(),
  status: z.enum(UNIT_STATUSES),
  connectionId: z.int(),
  connectionFolio: z.string(),
  address: z.string(),
  blockCode: z.string().nullable(),
  holder: personBasicSchema.nullable(),
  /** What the unit owes today (API step 5). */
  debt: debtSummarySchema,
});

export const searchResponseSchema = z.object({
  people: z.array(personBasicSchema),
  connections: z.array(searchConnectionSchema),
  units: z.array(searchUnitSchema),
});

// --- People ---------------------------------------------------------------------------------

const personName = {
  givenNames: requiredText(80, 'Escribe el nombre o los nombres.'),
  paternalSurname: requiredText(80, 'Escribe el apellido paterno.'),
  maternalSurname: optionalText(80),
};

export const personMatchesQuerySchema = z.object(personName);

export const personMatchesResponseSchema = z.object({
  /** Same normalized name: a homonym or the same person (D-10). */
  exact: z.array(personBasicSchema),
  /** Similar names, to catch typos before registering a duplicate. */
  similar: z.array(personBasicSchema),
});

export const createPersonRequestSchema = z.object({
  ...personName,
  distinguishingNote: optionalText(80),
  phone: optionalText(20),
  registeredOn: z.iso.date().optional(),
});

/** A unit of the person: full data in the viewer's scope, only "another block" outside it. */
export const personUnitSchema = z.discriminatedUnion('scope', [
  z.object({
    scope: z.literal('own'),
    id: z.int(),
    folio: z.string(),
    reference: z.string().nullable(),
    status: z.enum(UNIT_STATUSES),
    connectionId: z.int(),
    connectionFolio: z.string(),
    address: z.string(),
    blockCode: z.string().nullable(),
    holderSince: z.iso.date(),
    debt: debtSummarySchema,
  }),
  z.object({ scope: z.literal('other_block') }),
]);

export const personConnectionRequestSchema = z.object({
  id: z.int(),
  folio: z.string(),
  status: z.string(),
  address: z.string(),
  blockCode: z.string().nullable(),
});

export const personDetailSchema = z.discriminatedUnion('access', [
  personBasicSchema.extend({
    access: z.literal('full'),
    givenNames: z.string(),
    paternalSurname: z.string(),
    maternalSurname: z.string().nullable(),
    phone: z.string().nullable(),
    registeredOn: z.iso.date(),
    units: z.array(personUnitSchema),
    /** Sum of what the units in scope owe (units of other blocks excluded). */
    totalDue: z.int(),
    connectionRequests: z.array(personConnectionRequestSchema),
  }),
  personBasicSchema.extend({ access: z.literal('basic') }),
]);

export const personResponseSchema = z.object({ person: personDetailSchema });

// --- Units ----------------------------------------------------------------------------------

export const createUnitRequestSchema = z.object({
  connectionId: z.int({ error: 'Elige la toma.' }).positive(),
  holderPersonId: z.int({ error: 'Elige al titular.' }).positive(),
  reference: optionalText(80),
  registeredOn: z.iso.date().optional(),
  /** First month to bill: the registration month, or the first pending month of the paper
   * ledger for units that existed at startup (D-18). */
  billingStartPeriod: periodSchema.optional(),
});

const holderSchema = personBasicSchema.extend({
  validFrom: z.iso.date(),
  validTo: z.iso.date().nullable(),
});

export const unitDetailSchema = z.object({
  id: z.int(),
  folio: z.string(),
  reference: z.string().nullable(),
  status: z.enum(UNIT_STATUSES),
  registeredOn: z.iso.date(),
  activatedOn: z.iso.date().nullable(),
  billingStartPeriod: periodSchema.nullable(),
  deactivatedOn: z.iso.date().nullable(),
  connection: z.object({
    id: z.int(),
    folio: z.string(),
    address: z.string(),
    blockId: z.int().nullable(),
    blockCode: z.string().nullable(),
  }),
  holder: personBasicSchema.nullable(),
  holders: z.array(holderSchema),
  suspensions: z.array(
    z.object({
      id: z.int(),
      target: z.enum(['unit', 'connection']),
      periodFrom: periodSchema,
      periodTo: periodSchema.nullable(),
      reason: z.string(),
    }),
  ),
  payments: z.array(
    z.object({
      id: z.int(),
      folio: z.string(),
      occurredAt: z.iso.datetime(),
      total: z.int(),
      cancelled: z.boolean(),
    }),
  ),
  pendingChange: z
    .object({ type: z.enum(['deactivation', 'holder_change']), approvalId: z.int() })
    .nullable(),
});

export const unitResponseSchema = z.object({ unit: unitDetailSchema });

// --- Deactivation and holder change (approved by the president) --------------------------

const reason = requiredText(500, 'Escribe el motivo.');

export const unitDeactivationRequestSchema = z.object({ reason });

export const unitHolderChangeRequestSchema = z.object({
  newHolderId: z.int({ error: 'Elige al nuevo titular.' }).positive(),
  reason,
});

export const unitChangeRequestResponseSchema = z.object({
  request: z.object({
    id: z.int(),
    unitId: z.int(),
    type: z.enum(['deactivation', 'holder_change']),
    newHolder: personBasicSchema.nullable(),
    approvalId: z.int(),
  }),
});

// --- Suspensions (D-06) ---------------------------------------------------------------------

export const createSuspensionRequestSchema = z
  .object({
    connectionId: z.int().positive().optional(),
    unitId: z.int().positive().optional(),
    periodFrom: periodSchema,
    reason,
    agreementId: z.int({ error: 'Indica el acuerdo de junta.' }).positive(),
  })
  .refine((body) => (body.connectionId === undefined) !== (body.unitId === undefined), {
    path: ['connectionId'],
    error: 'Suspende una toma o una unidad, no ambas ni ninguna.',
  });

export const endSuspensionRequestSchema = z.object({ periodTo: periodSchema });

export const suspensionSchema = z.object({
  id: z.int(),
  connectionId: z.int().nullable(),
  unitId: z.int().nullable(),
  periodFrom: periodSchema,
  periodTo: periodSchema.nullable(),
  reason: z.string(),
  agreementId: z.int(),
});

export const suspensionResponseSchema = z.object({ suspension: suspensionSchema });

export type SearchResponse = z.infer<typeof searchResponseSchema>;
export type PersonMatchesQuery = z.infer<typeof personMatchesQuerySchema>;
export type CreatePersonRequest = z.infer<typeof createPersonRequestSchema>;
export type PersonDetail = z.infer<typeof personDetailSchema>;
export type PersonUnit = z.infer<typeof personUnitSchema>;
export type CreateUnitRequest = z.infer<typeof createUnitRequestSchema>;
export type UnitDetail = z.infer<typeof unitDetailSchema>;
export type UnitHolderChangeRequest = z.infer<typeof unitHolderChangeRequestSchema>;
export type CreateSuspensionRequest = z.infer<typeof createSuspensionRequestSchema>;
export type Suspension = z.infer<typeof suspensionSchema>;
