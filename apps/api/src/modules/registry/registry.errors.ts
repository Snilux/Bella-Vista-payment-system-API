import type { PersonBasic } from '@bella-vista/shared';
import { AppError, errors } from '../../lib/errors.js';

export const registryErrors = {
  personNotFound: () => new AppError('NOT_FOUND', 404, 'No existe esa persona.'),
  unitNotFound: () => new AppError('NOT_FOUND', 404, 'No existe esa unidad.'),
  connectionNotFound: () => new AppError('NOT_FOUND', 404, 'No existe esa toma.'),
  suspensionNotFound: () => new AppError('NOT_FOUND', 404, 'No existe esa suspensión.'),
  agreementNotFound: () => new AppError('NOT_FOUND', 404, 'No existe ese acuerdo.'),
  homonymWithoutNote: (matches: PersonBasic[]) =>
    new AppError(
      'HOMONYM_WITHOUT_NOTE',
      422,
      'Ya existe una persona con ese nombre. Si es otra persona, agregue un distintivo (por ejemplo, la clave de su manzana).',
      { matches },
    ),
  duplicateNote: () =>
    new AppError(
      'DUPLICATE_DISTINGUISHING_NOTE',
      409,
      'Ya existe una persona con ese nombre y ese distintivo.',
    ),
  connectionNotActive: (status: string) =>
    new AppError('CONNECTION_NOT_ACTIVE', 422, 'Solo se agregan familias a una toma activa.', {
      status,
    }),
  invalidField: (path: string, message: string) =>
    errors.validation({ issues: [{ path, message }] }),
};
