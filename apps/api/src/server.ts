import Fastify from 'fastify';

// Minimal bootstrap, only to verify the environment (Docker, ports, hot reload).
// The real application will be built in src/app.ts following docs/estructura.md.
const port = Number(process.env.API_PORT ?? 3000);

const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL ?? 'info',
    ...(process.env.NODE_ENV === 'development' && { transport: { target: 'pino-pretty' } }),
  },
});

app.get('/health', async () => ({ status: 'ok' }));

const shutdown = async () => {
  await app.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await app.listen({ port, host: '0.0.0.0' });
