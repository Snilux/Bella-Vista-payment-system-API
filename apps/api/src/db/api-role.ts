import postgres from 'postgres';

// The API database user (agua_api) logs in with the user and password written in DATABASE_URL:
// that URL is the only place its password lives. `pnpm db:migrate` re-applies it to the role
// on every run through the owner's connection, so the role and DATABASE_URL never drift apart,
// whether the database volume is new or old. Roles belong to the PostgreSQL server, not to a
// database, so the same role serves the main database and agua_test.

export const API_ROLE = 'agua_api';

export interface ApiLogin {
  role: string;
  password: string;
}

export class ApiRoleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ApiRoleError';
  }
}

/**
 * The role and password the API logs in with, read from DATABASE_URL. Returns null when
 * DATABASE_URL connects as the migrations user (an old environment with no separate API user),
 * so there is nothing to adjust.
 */
export function apiLoginFromUrls(databaseUrl: string, migrationsUrl: string): ApiLogin | null {
  const api = new URL(databaseUrl);
  const owner = new URL(migrationsUrl);
  const role = decodeURIComponent(api.username);
  if (role === decodeURIComponent(owner.username)) return null;
  if (role !== API_ROLE) {
    throw new ApiRoleError(
      `DATABASE_URL debe conectarse como ${API_ROLE} (tiene "${role}"): es el único usuario con los permisos de la API.`,
    );
  }
  const password = decodeURIComponent(api.password);
  if (password === '') {
    throw new ApiRoleError(`DATABASE_URL no incluye la contraseña de ${API_ROLE}.`);
  }
  return { role, password };
}

/**
 * Enables LOGIN on the role and sets its password, through a connection of the owner. Running
 * it again with the same password changes nothing. The server quotes the values (format %I/%L)
 * because ALTER ROLE does not accept bind parameters; the password is never logged.
 */
export async function syncApiRole(owner: postgres.Sql, login: ApiLogin): Promise<void> {
  const exists = await owner`SELECT 1 FROM pg_roles WHERE rolname = ${login.role}`;
  if (exists.length === 0) {
    throw new ApiRoleError(
      `El rol ${login.role} no existe; lo crea la migración 0015 al aplicar las migraciones.`,
    );
  }
  const [row] = await owner<{ statement: string }[]>`
    SELECT format('ALTER ROLE %I WITH LOGIN PASSWORD %L', ${login.role}::text, ${login.password}::text)
      AS statement`;
  if (row === undefined) throw new ApiRoleError('No se pudo preparar ALTER ROLE.');
  await owner.unsafe(row.statement);
}

/** Logs in with `url` and returns the connected user, proving the credentials work. */
export async function checkLogin(url: string): Promise<string> {
  const client = postgres(url, { max: 1, onnotice: () => {} });
  try {
    const [row] = await client<{ user: string }[]>`SELECT current_user AS user`;
    return row?.user ?? '';
  } finally {
    await client.end();
  }
}
