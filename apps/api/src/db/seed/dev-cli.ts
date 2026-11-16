import { createDb } from '../client.js';
import { createSeedLogger, loadSeedEnv } from './cli-support.js';
import { DEV_PASSWORD, DevSeedRefusedError, runDevSeed } from './dev-data.js';

// `pnpm db:seed:dev`: development data on top of the bootstrap. Refuses NODE_ENV=production.

const env = loadSeedEnv();
const log = createSeedLogger(env);

if (env.NODE_ENV === 'production') {
  log.error('pnpm db:seed:dev no se ejecuta con NODE_ENV=production: solo carga datos de prueba.');
  process.exit(1);
}

const { db, sql } = createDb(env.DATABASE_URL, { max: 1 });
try {
  const result = await runDevSeed(db, { nodeEnv: env.NODE_ENV });
  if (result.status === 'already_seeded') {
    log.warn('La base ya tiene secciones registradas; no se cargaron datos de desarrollo.');
  } else {
    const { counts } = result;
    log.info(
      `Datos de desarrollo cargados: ${counts.people} personas, ${counts.connections} tomas, ${counts.units} familias y ${counts.payments} pagos.`,
    );
    process.stdout.write(
      [
        '',
        `  Cuentas de desarrollo (contraseña: ${DEV_PASSWORD})`,
        ...result.accounts.map((a) => `  ${a.username.padEnd(14)} ${a.role}`),
        '',
        '',
      ].join('\n'),
    );
  }
} catch (error) {
  if (error instanceof DevSeedRefusedError) {
    log.error(error.message);
  } else {
    log.error({ err: error }, 'La carga de datos de desarrollo falló; no se guardó ningún cambio.');
  }
  process.exitCode = 1;
} finally {
  await sql.end();
}
