import { randomInt } from 'node:crypto';
import argon2 from 'argon2';

// Account passwords (usuario.contrasena_hash, 2.2 §4.1): Argon2id with the library defaults.
// The login (API step 2) verifies with verifyPassword, so the bootstrap and account services
// must hash with hashPassword.

export function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, { type: argon2.argon2id });
}

export function verifyPassword(hash: string, plain: string): Promise<boolean> {
  return argon2.verify(hash, plain);
}

// No 0/O, 1/l/I: the temporary password is read aloud or copied by hand (D-19).
const TEMPORARY_PASSWORD_ALPHABET = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** Random temporary password; the account must change it on first login. */
export function generateTemporaryPassword(length = 12): string {
  let password = '';
  for (let i = 0; i < length; i++) {
    password += TEMPORARY_PASSWORD_ALPHABET[randomInt(TEMPORARY_PASSWORD_ALPHABET.length)];
  }
  return password;
}
