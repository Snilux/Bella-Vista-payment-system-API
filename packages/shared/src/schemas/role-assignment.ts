import { z } from 'zod';
import {
  ASSIGNABLE_ROLES,
  type RoleAssignmentRule,
  roleAssignmentViolations,
} from '../domain/role-assignment.js';

const ruleIssue: Record<RoleAssignmentRule, { path: 'blockId' | 'contactPhone'; message: string }> =
  {
    BLOCK_LEADER_REQUIRES_BLOCK: {
      path: 'blockId',
      message: 'El jefe de manzana debe tener una manzana.',
    },
    BLOCK_LEADER_REQUIRES_CONTACT_PHONE: {
      path: 'contactPhone',
      message: 'El jefe de manzana debe tener un teléfono de contacto.',
    },
    BLOCK_ONLY_FOR_BLOCK_LEADER: {
      path: 'blockId',
      message: 'Solo el jefe de manzana puede tener una manzana asignada.',
    },
  };

/**
 * Body of `POST /v1/role-assignments` (SEC registers, PRE approves). The approval is created
 * by the service, so it is not part of the input.
 */
export const createRoleAssignmentSchema = z
  .object({
    personId: z.int().positive(),
    role: z.enum(ASSIGNABLE_ROLES),
    blockId: z.int().positive().nullish(),
    contactPhone: z.string().trim().min(1, 'El teléfono no puede estar vacío.').nullish(),
    startDate: z.iso.date(),
  })
  .superRefine((input, ctx) => {
    for (const rule of roleAssignmentViolations(input)) {
      const { path, message } = ruleIssue[rule];
      ctx.addIssue({ code: 'custom', path: [path], message, params: { rule } });
    }
  });

export type CreateRoleAssignmentInput = z.infer<typeof createRoleAssignmentSchema>;
