import { createDb } from '../client.js';
import { createSeedLogger, loadSeedEnv } from './cli-support.js';
import {
  applyDevOpeningFee,
  applyDevSuperadminPassword,
  DEV_PASSWORD,
  DevSeedRefusedError,
  runDevSeed,
} from './dev-data.js';

// `pnpm db:seed:dev`: development data on top of the bootstrap, and a known password for the
// superadmin (also on an already seeded database). Refuses NODE_ENV=production.

const env = loadSeedEnv();
const log = createSeedLogger(env);

if (env.NODE_ENV === 'production') {
  log.error('pnpm db:seed:dev no se ejecuta con NODE_ENV=production: solo carga datos de prueba.');
  process.exit(1);
}

const { db, sql } = createDb(env.DATABASE_URL, { max: 1 });
try {
  const result = await runDevSeed(db, { nodeEnv: env.NODE_ENV });
  const superadmin = await applyDevSuperadminPassword(db, { nodeEnv: env.NODE_ENV });
  if (superadmin.changed) {
    log.info(`El superadministrador ${superadmin.username} ahora usa la contraseña de desarrollo.`);
  }
  const openingFee = await applyDevOpeningFee(db, { nodeEnv: env.NODE_ENV });
  if (openingFee.changed) {
    log.info('La cuota de apertura ahora tiene el importe de desarrollo ($1,500.00).');
  }
  if (result.status === 'already_seeded') {
    log.warn('La base ya tiene secciones registradas; no se cargaron datos de desarrollo.');
    process.stdout.write(
      `\n  Cuentas de desarrollo (contraseña: ${DEV_PASSWORD}): vea "Cuentas de desarrollo" en el README.\n\n`,
    );
  } else {
    const { counts } = result;
    log.info(
      `Datos de desarrollo cargados: ${counts.people} personas, ${counts.connections} tomas, ${counts.units} familias y ${counts.payments} pagos.`,
    );
    process.stdout.write(
      [
        '',
        `  Cuentas de desarrollo (contraseña: ${DEV_PASSWORD})`,
        `  ${superadmin.username.padEnd(14)} superadmin`,
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
