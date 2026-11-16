import { z } from 'zod';
import { ROLES } from '../domain/role-assignment.js';

// Session endpoints (/v1/auth, docs/api.md "Detalle: sesión y cuentas"; CU-01, RF-AUT).

/** RNF-SEG-02: at least 8 characters; the upper bound keeps Argon2 input reasonable. */
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

export const newPasswordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, {
    error: `La contraseña debe tener al menos ${PASSWORD_MIN_LENGTH} caracteres.`,
  })
  .max(PASSWORD_MAX_LENGTH, {
    error: `La contraseña no puede tener más de ${PASSWORD_MAX_LENGTH} caracteres.`,
  });

/** Any password as typed (login, current password); never trimmed. */
const enteredPassword = z
  .string()
  .min(1, { error: 'Escribe la contraseña.' })
  .max(256, { error: 'La contraseña es demasiado larga.' });

const refreshTokenField = z
  .string()
  .min(1, { error: 'Falta el token de refresco.' })
  .max(256, { error: 'El token de refresco no es válido.' });

export const loginRequestSchema = z.object({
  username: z
    .string()
    .trim()
    .toLowerCase()
    .min(1, { error: 'Escribe tu usuario.' })
    .max(64, { error: 'El usuario es demasiado largo.' }),
  password: enteredPassword,
});

/** The account as the app needs it right after signing in (RF-AUT-07). */
export const sessionAccountSchema = z.object({
  username: z.string(),
  role: z.enum(ROLES),
  blockId: z.int().nullable(),
  mustChangePassword: z.boolean(),
});

export const sessionResponseSchema = z.object({
  accessToken: z.string(),
  /** Seconds until the access token expires. */
  accessTokenExpiresIn: z.int(),
  refreshToken: z.string(),
  account: sessionAccountSchema,
});

export const refreshRequestSchema = z.object({ refreshToken: refreshTokenField });

export const logoutRequestSchema = z.object({ refreshToken: refreshTokenField });

export const changePasswordRequestSchema = z
  .object({ currentPassword: enteredPassword, newPassword: newPasswordSchema })
  .refine((body) => body.newPassword !== body.currentPassword, {
    path: ['newPassword'],
    error: 'La contraseña nueva debe ser distinta de la actual.',
  });

export type LoginRequest = z.infer<typeof loginRequestSchema>;
export type SessionAccount = z.infer<typeof sessionAccountSchema>;
export type SessionResponse = z.infer<typeof sessionResponseSchema>;
export type RefreshRequest = z.infer<typeof refreshRequestSchema>;
export type LogoutRequest = z.infer<typeof logoutRequestSchema>;
export type ChangePasswordRequest = z.infer<typeof changePasswordRequestSchema>;
