import { z } from 'zod';

// Shape of arranque.json, read by `pnpm db:seed` (D-27). The file is filled in by whoever
// runs the bootstrap, so its keys and messages are in Spanish (see arranque.example.json).

const requiredText = (field: string) =>
  z
    .string({ error: `${field} es obligatorio.` })
    .trim()
    .min(1, { error: `${field} no puede estar vacío.` });

const optionalText = z
  .string({ error: 'Debe ser texto.' })
  .trim()
  .nullish()
  .transform((value) => (value ? value : null));

const isoDate = (field: string) =>
  z.iso.date({ error: `${field} debe ser una fecha válida con formato AAAA-MM-DD.` });

const votes = z
  .int({ error: 'Los votos deben ser un número entero.' })
  .min(0, { error: 'Los votos no pueden ser negativos.' })
  .max(32_767, { error: 'Número de votos fuera de rango.' })
  .nullish()
  .transform((value) => value ?? null);

const section = (field: string) => ({ error: `${field} es obligatorio y debe ser un objeto.` });

const personShape = {
  nombres: requiredText('nombres'),
  apellidoPaterno: requiredText('apellidoPaterno'),
  apellidoMaterno: optionalText,
  distintivo: optionalText,
  telefono: optionalText,
};

const officerSchema = (field: string) =>
  z.object({ ...personShape, fechaInicio: isoDate('fechaInicio') }, section(field));

export const bootstrapFileSchema = z
  .object(
    {
      superadministrador: z.object(
        {
          ...personShape,
          usuario: z.string({ error: 'usuario es obligatorio.' }).regex(/^[a-z0-9._-]{3,32}$/, {
            error:
              'usuario debe tener de 3 a 32 caracteres en minúsculas: letras, números, punto, guion o guion bajo.',
          }),
        },
        section('superadministrador'),
      ),
      acuerdo: z.object(
        {
          fechaJunta: isoDate('fechaJunta'),
          tema: requiredText('tema'),
          votosFavor: votes,
          votosContra: votes,
          abstenciones: votes,
          referenciaActa: optionalText,
        },
        section('acuerdo'),
      ),
      presidente: officerSchema('presidente'),
      tesorero: officerSchema('tesorero'),
      secretario: officerSchema('secretario'),
    },
    { error: 'arranque.json debe contener un objeto.' },
  )
  .superRefine((file, ctx) => {
    for (const role of ['presidente', 'tesorero', 'secretario'] as const) {
      if (file[role].fechaInicio < file.acuerdo.fechaJunta) {
        ctx.addIssue({
          code: 'custom',
          path: [role, 'fechaInicio'],
          message:
            'La fecha de inicio no puede ser anterior a la fecha de la junta que eligió al comité.',
        });
      }
    }
  });

export type BootstrapFile = z.infer<typeof bootstrapFileSchema>;

/** Person data shared by the superadmin and the officers. */
export type BootstrapPerson = Pick<
  BootstrapFile['presidente'],
  'nombres' | 'apellidoPaterno' | 'apellidoMaterno' | 'distintivo' | 'telefono'
>;

export class InvalidBootstrapFileError extends Error {
  constructor(readonly issues: string[]) {
    super(`arranque.json no es válido:\n${issues.map((issue) => `  - ${issue}`).join('\n')}`);
    this.name = 'InvalidBootstrapFileError';
  }
}

/** Validates the parsed content of arranque.json; throws with every issue in Spanish. */
export function parseBootstrapFile(content: unknown): BootstrapFile {
  const result = bootstrapFileSchema.safeParse(content);
  if (!result.success) {
    throw new InvalidBootstrapFileError(
      result.error.issues.map((issue) =>
        issue.path.length > 0 ? `${issue.path.join('.')}: ${issue.message}` : issue.message,
      ),
    );
  }
  return result.data;
}
