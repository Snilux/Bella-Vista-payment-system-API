import { AppError } from '../../lib/errors.js';

export const accountErrors = {
  assignmentNotFound: () => new AppError('NOT_FOUND', 404, 'No existe esa asignación de cargo.'),
  accountNotFound: () => new AppError('NOT_FOUND', 404, 'No existe esa cuenta.'),
  assignmentHasAccount: () =>
    new AppError('ASSIGNMENT_HAS_ACCOUNT', 409, 'Esa asignación de cargo ya tiene una cuenta.'),
  assignmentNotActive: () =>
    new AppError(
      'ASSIGNMENT_NOT_ACTIVE',
      422,
      'Solo se crean cuentas para asignaciones de cargo autorizadas y vigentes.',
    ),
  usernameTaken: (username: string) =>
    new AppError('USERNAME_TAKEN', 409, `El usuario "${username}" ya existe.`, { username }),
  ownAccount: () =>
    new AppError('FORBIDDEN', 403, 'No puede bloquear ni desactivar su propia cuenta.'),
};
