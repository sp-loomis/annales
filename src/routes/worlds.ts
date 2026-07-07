import type { FastifyInstance } from 'fastify';
import { notFound } from '../lib/errors.js';
import { thumbKeyFor } from '../lib/artifact-util.js';
import { dropWorldIndex } from '../lib/search-index.js';

const worldBody = {
  type: 'object',
  required: ['name'],
  properties: { name: { type: 'string', minLength: 1 } },
} as const;

const serialize = (w: { id: string; name: string }) => ({ id: w.id, name: w.name });

export function worldRoutes(app: FastifyInstance): void {
  app.post<{ Body: { name: string } }>('/worlds', { schema: { body: worldBody } }, async (req, reply) => {
    const world = await app.prisma.world.create({ data: { name: req.body.name } });
    return reply.code(201).send(serialize(world));
  });

  app.get('/worlds', async () => {
    const worlds = await app.prisma.world.findMany({ orderBy: { name: 'asc' } });
    return { items: worlds.map(serialize), nextCursor: null };
  });

  app.get<{ Params: { worldId: string } }>('/worlds/:worldId', async (req) => {
    const world = await app.prisma.world.findUnique({ where: { id: req.params.worldId } });
    if (!world) throw notFound('world', req.params.worldId);
    return serialize(world);
  });

  app.patch<{ Params: { worldId: string }; Body: { name: string } }>(
    '/worlds/:worldId',
    { schema: { body: worldBody } },
    async (req) => {
      const existing = await app.prisma.world.findUnique({ where: { id: req.params.worldId } });
      if (!existing) throw notFound('world', req.params.worldId);
      const world = await app.prisma.world.update({
        where: { id: existing.id },
        data: { name: req.body.name },
      });
      return serialize(world);
    }
  );

  app.delete<{ Params: { worldId: string } }>('/worlds/:worldId', async (req, reply) => {
    const { worldId } = req.params;
    const world = await app.prisma.world.findUnique({ where: { id: worldId } });
    if (!world) throw notFound('world', worldId);

    // Storage objects first (best-effort — versioning keeps history anyway).
    const inWorld = { entry: { worldId } };
    const [docs, images, sketches, geometries] = await Promise.all([
      app.prisma.document.findMany({ where: inWorld, select: { filePath: true } }),
      app.prisma.image.findMany({ where: inWorld, select: { filePath: true } }),
      app.prisma.sketch.findMany({ where: inWorld, select: { filePath: true } }),
      app.prisma.geometry.findMany({ where: inWorld, select: { filePath: true } }),
    ]);
    const keys = [
      ...docs.map((d) => d.filePath),
      ...images.flatMap((i) => [i.filePath, thumbKeyFor(i.filePath)]),
      ...sketches.map((s) => s.filePath),
      ...geometries.map((g) => g.filePath),
    ];
    try {
      await app.store.deleteAll(keys);
    } catch (err) {
      req.log.warn({ err }, 'storage cleanup failed during world delete');
    }

    await dropWorldIndex(app.prisma, worldId);
    // Relations must go before the world cascade reaches RelationType
    // (Relation.typeId is RESTRICT). Relations are always intra-world, so
    // deleting by type.worldId covers every edge in this world.
    await app.prisma.$transaction([
      app.prisma.relation.deleteMany({ where: { type: { worldId } } }),
      app.prisma.world.delete({ where: { id: worldId } }),
    ]);
    return reply.code(204).send();
  });
}
