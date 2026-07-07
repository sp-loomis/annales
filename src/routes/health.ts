import type { FastifyInstance } from 'fastify';

export function healthRoutes(app: FastifyInstance): void {
  app.get('/healthz', async (_req, reply) => {
    try {
      await app.prisma.$queryRaw`SELECT 1`;
      if (!(await app.store.healthy())) throw new Error('storage unreachable');
      return { ok: true };
    } catch {
      return reply.code(503).send({ ok: false });
    }
  });
}
