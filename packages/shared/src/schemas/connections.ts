import { z } from 'zod';
import { debtSummarySchema } from './billing.js';
import {
  optionalText,
  page,
  paginationQuerySchema,
  periodSchema,
  personBasicSchema,
  requiredText,
} from './common.js';
import { CONNECTION_STATUSES, UNIT_STATUSES } from './registry.js';

// Connections endpoints (/v1/connections, /v1/agreements, /v1/connection-requests; CU-08,
// CU-09, RF-TOM, D-12, D-13, D-18).

export const CONNECTION_REQUEST_STATUSES = [
  'requested',
  'approved_pending_payment',
  'pending_installation',
  'rejected',
  'cancelled',
  'installed',
] as const;

export type ConnectionRequestStatus = (typeof CONNECTION_REQUEST_STATUSES)[number];

// --- Connections ----------------------------------------------------------------------------

export const createPreexistingConnectionRequestSchema = z.object({
  address: requiredText(200, 'Escriba la dirección de la toma.'),
  blockId: z.int({ error: 'Elija la manzana.' }).positive(),
  activatedOn: z.iso.date().optional(),
  /** Its first unit (D-18): holder and first pending month of the paper ledger. */
  unit: z.object({
    holderPersonId: z.int({ error: 'Elija al titular.' }).positive(),
    reference: optionalText(80),
    registeredOn: z.iso.date().optional(),
    billingStartPeriod: periodSchema,
  }),
});

export const connectionDetailSchema = z.object({
  id: z.int(),
  folio: z.string(),
  address: z.string(),
  status: z.enum(CONNECTION_STATUSES),
  activatedOn: z.iso.date(),
  deactivatedOn: z.iso.date().nullable(),
  blockId: z.int().nullable(),
  blockCode: z.string().nullable(),
  connectionRequestId: z.int().nullable(),
  units: z.array(
    z.object({
      id: z.int(),
      folio: z.string(),
      reference: z.string().nullable(),
      status: z.enum(UNIT_STATUSES),
      billingStartPeriod: periodSchema.nullable(),
      holder: personBasicSchema.nullable(),
      debt: debtSummarySchema,
    }),
  ),
  /** Sum of what its units owe today. */
  totalDue: z.int(),
});

export const connectionResponseSchema = z.object({ connection: connectionDetailSchema });

// --- Agreements -----------------------------------------------------------------------------

const votes = z
  .int()
  .min(0)
  .max(32_767)
  .nullish()
  .transform((value) => value ?? null);

export const agreementSchema = z.object({
  id: z.int(),
  folio: z.string(),
  meetingDate: z.iso.date(),
  topic: z.string(),
  result: z.enum(['approved_by_majority', 'rejected']),
  votesFor: z.int().nullable(),
  votesAgainst: z.int().nullable(),
  abstentions: z.int().nullable(),
  minutesReference: z.string().nullable(),
  correctsId: z.int().nullable(),
});

export const createAgreementRequestSchema = z.object({
  meetingDate: z.iso.date({ error: 'La fecha de la junta debe tener el formato AAAA-MM-DD.' }),
  topic: requiredText(300, 'Escriba el tema del acuerdo.'),
  result: z.enum(['approved_by_majority', 'rejected'], {
    error: 'Indique si se aprobó por mayoría o se rechazó.',
  }),
  votesFor: votes,
  votesAgainst: votes,
  abstentions: votes,
  minutesReference: optionalText(200),
  correctsId: z
    .int()
    .positive()
    .nullish()
    .transform((value) => value ?? null),
});

export const agreementPageSchema = page(agreementSchema);
export const agreementResponseSchema = z.object({ agreement: agreementSchema });

// --- Connection requests --------------------------------------------------------------------

export const connectionRequestSchema = z.object({
  id: z.int(),
  folio: z.string(),
  status: z.enum(CONNECTION_REQUEST_STATUSES),
  applicant: personBasicSchema,
  address: z.string(),
  blockId: z.int(),
  blockCode: z.string(),
  requestedOn: z.iso.date(),
  agreement: z
    .object({
      id: z.int(),
      folio: z.string(),
      result: z.enum(['approved_by_majority', 'rejected']),
    })
    .nullable(),
  resolutionReason: z.string().nullable(),
  cancelledOn: z.iso.date().nullable(),
  cancellationReason: z.string().nullable(),
  /** The opening fee charged when approved, at the amount in force that day (D-13). */
  openingCharge: z
    .object({
      id: z.int(),
      feeName: z.string(),
      amount: z.int(),
      chargedOn: z.iso.date(),
      cancelledOn: z.iso.date().nullable(),
    })
    .nullable(),
  connectionId: z.int().nullable(),
});

export const connectionRequestListQuerySchema = paginationQuerySchema.extend({
  status: z.enum(CONNECTION_REQUEST_STATUSES).optional(),
  blockId: z.coerce.number().int().positive().optional(),
});

export const createConnectionRequestRequestSchema = z.object({
  applicantId: z.int({ error: 'Elija al solicitante.' }).positive(),
  address: requiredText(200, 'Escriba la dirección solicitada.'),
  blockId: z.int({ error: 'Elija la manzana.' }).positive(),
  requestedOn: z.iso.date().optional(),
});

export const resolveConnectionRequestRequestSchema = z.object({
  agreementId: z.int({ error: 'Indique el acuerdo de junta.' }).positive(),
  resolutionReason: optionalText(500),
});

export const activateConnectionRequestRequestSchema = z.object({
  activatedOn: z.iso.date().optional(),
  /** Address of the installed connection when it differs from the requested one. */
  address: optionalText(200),
  reference: optionalText(80),
});

export const cancelConnectionRequestRequestSchema = z.object({
  reason: requiredText(500, 'Escriba el motivo.'),
});

export const connectionRequestPageSchema = page(connectionRequestSchema);
export const connectionRequestResponseSchema = z.object({ request: connectionRequestSchema });
export const activationResponseSchema = z.object({
  request: connectionRequestSchema,
  connection: connectionDetailSchema,
});

export type CreatePreexistingConnectionRequest = z.infer<
  typeof createPreexistingConnectionRequestSchema
>;
export type ConnectionDetail = z.infer<typeof connectionDetailSchema>;
export type Agreement = z.infer<typeof agreementSchema>;
export type CreateAgreementRequest = z.infer<typeof createAgreementRequestSchema>;
export type ConnectionRequest = z.infer<typeof connectionRequestSchema>;
export type ConnectionRequestListQuery = z.infer<typeof connectionRequestListQuerySchema>;
export type CreateConnectionRequestRequest = z.infer<typeof createConnectionRequestRequestSchema>;
export type ResolveConnectionRequestRequest = z.infer<typeof resolveConnectionRequestRequestSchema>;
export type ActivateConnectionRequestRequest = z.infer<
  typeof activateConnectionRequestRequestSchema
>;
