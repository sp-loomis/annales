import type { FastifyInstance } from 'fastify';

export function healthRoutes(app: FastifyInstance): void {
  app.get('/healthz', async (_req, reply) => {
    let db = true;
    try {
      await app.prisma.$queryRaw`SELECT 1`;
    } catch {
      db = false;
    }
    const storage = await app.store.healthy();
    if (db && storage) return { ok: true };
    return reply.code(503).send({ ok: false, db, storage });
  });
}
