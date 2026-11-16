import { z } from 'zod';

// Building blocks shared by several endpoint schemas (docs/api.md, "Convenciones").

/** Billing period as text AAAA-MM (2.3). */
export const periodSchema = z
  .string({ error: 'El periodo debe tener el formato AAAA-MM.' })
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, { error: 'El periodo debe tener el formato AAAA-MM.' });

export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, { error: `No puede tener más de ${max} caracteres.` })
    .nullish()
    .transform((value) => (value ? value : null));

export const requiredText = (max: number, message: string) =>
  z
    .string({ error: message })
    .trim()
    .min(1, { error: message })
    .max(max, { error: `No puede tener más de ${max} caracteres.` });

/** Keyset pagination (2.3): `?limit=20&cursor=...` → `{ data, next }`. */
export const paginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.coerce.number().int().positive().optional(),
});

export const page = <T extends z.ZodType>(item: T) =>
  z.object({ data: z.array(item), next: z.string().nullable() });

/** Minimal person data: everything a block leader sees of a person outside their block. */
export const personBasicSchema = z.object({
  id: z.int(),
  folio: z.string(),
  fullName: z.string(),
  distinguishingNote: z.string().nullable(),
});

export type PersonBasic = z.infer<typeof personBasicSchema>;
export type PaginationQuery = z.infer<typeof paginationQuerySchema>;
