import { AppError } from '../../lib/errors.js';

export const authErrors = {
  /** Unknown username or wrong password: never says which (2.3 CREDENCIALES_INVALIDAS). */
  invalidCredentials: () =>
    new AppError('INVALID_CREDENTIALS', 401, 'Usuario o contraseña incorrectos.'),
  wrongCurrentPassword: () =>
    new AppError('INVALID_CREDENTIALS', 401, 'La contraseña actual no es correcta.'),
  /** Refresh token unknown, expired, revoked or reused. */
  sessionInvalid: () =>
    new AppError('UNAUTHENTICATED', 401, 'Su sesión ya no es válida. Inicie sesión de nuevo.'),
};
