import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createDb } from '../client.js';
import { runBootstrap } from './bootstrap.js';
import { InvalidBootstrapFileError, parseBootstrapFile } from './bootstrap-file.js';
import { createSeedLogger, invocationDir, loadSeedEnv } from './cli-support.js';

// `pnpm db:seed [path/to/arranque.json]`: initial bootstrap (D-27). Defaults to arranque.json
// in the directory pnpm was run from (the repository root).

const env = loadSeedEnv();
const log = createSeedLogger(env);
const filePath = resolve(invocationDir(), process.argv[2] ?? 'arranque.json');

let content: unknown;
try {
  content = JSON.parse(await readFile(filePath, 'utf8'));
} catch (error) {
  log.error(
    { err: error },
    `No se pudo leer ${filePath}. Copie arranque.example.json a arranque.json y llénelo.`,
  );
  process.exit(1);
}

let file: ReturnType<typeof parseBootstrapFile>;
try {
  file = parseBootstrapFile(content);
} catch (error) {
  if (error instanceof InvalidBootstrapFileError) {
    log.error(error.message);
    process.exit(1);
  }
  throw error;
}

const { db, sql } = createDb(env.DATABASE_URL, { max: 1 });
try {
  const result = await runBootstrap(db, file, {
    now: new Date(),
    timeZone: env.BUSINESS_TIMEZONE,
  });
  if (result.status === 'already_bootstrapped') {
    log.warn(
      `El sistema ya fue arrancado: existe el superadministrador "${result.username ?? '(sin cuenta)'}". No se hizo ningún cambio.`,
    );
  } else {
    log.info(
      `Arranque inicial completo. Acuerdo de elección ${result.agreementFolio}; presidente, tesorero y secretario autorizados por arranque.`,
    );
    // Written straight to stdout, never through the logger, so it does not end up in logs.
    process.stdout.write(
      [
        '',
        '  Cuenta del superadministrador',
        `  Usuario:              ${result.username}`,
        `  Contraseña temporal:  ${result.temporaryPassword}`,
        '',
        '  Se muestra una sola vez y no se guarda. Deberá cambiarse al iniciar sesión.',
        '',
        '',
      ].join('\n'),
    );
  }
} catch (error) {
  log.error({ err: error }, 'El arranque inicial falló; no se guardó ningún cambio.');
  process.exitCode = 1;
} finally {
  await sql.end();
}
