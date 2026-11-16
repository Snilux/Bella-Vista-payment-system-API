import { AppError, errors } from '../../lib/errors.js';

export const organizationErrors = {
  sectionNotFound: () => new AppError('NOT_FOUND', 404, 'No existe esa sección.'),
  blockNotFound: () => new AppError('NOT_FOUND', 404, 'No existe esa manzana.'),
  personNotFound: () => new AppError('NOT_FOUND', 404, 'No existe esa persona.'),
  assignmentNotFound: () => new AppError('NOT_FOUND', 404, 'No existe esa asignación de cargo.'),
  duplicateCode: (field: 'code' | 'name', value: string) =>
    new AppError(
      'DUPLICATE_CODE',
      409,
      field === 'code'
        ? `La clave ${value} ya está registrada.`
        : `El nombre "${value}" ya está registrado.`,
      { field, value },
    ),
  blockHasLeader: (blockCode: string) =>
    new AppError(
      'LEADER_ALREADY_ASSIGNED',
      409,
      `La manzana ${blockCode} ya tiene jefe o una solicitud pendiente.`,
      { reason: 'block_has_leader' },
    ),
  personIsLeader: () =>
    new AppError(
      'LEADER_ALREADY_ASSIGNED',
      409,
      'Esta persona ya es jefe de otra manzana o tiene una solicitud pendiente.',
      { reason: 'person_is_leader' },
    ),
  roleTaken: (roleLabel: string) =>
    new AppError(
      'ROLE_ALREADY_ASSIGNED',
      409,
      `Ya hay un ${roleLabel} vigente o una solicitud pendiente. Cierra primero la asignación actual.`,
    ),
  /** Business rules reported on a field, in the VALIDATION_ERROR format. */
  invalidField: (path: string, message: string) =>
    errors.validation({ issues: [{ path, message }] }),
};
