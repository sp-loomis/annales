import type { FastifyInstance } from 'fastify';
import { conflict, inUse, notFound } from '../lib/errors.js';

// Per-world entry-type registry. Entry.typeId references these; the slug is the
// API-facing value. Defaults are seeded on world create (see worlds.ts); all
// are deletable unless an entry still references them (409 IN_USE).

const createBody = {
  type: 'object',
  required: ['name', 'slug'],
  properties: {
    name: { type: 'string', minLength: 1 },
    slug: { type: 'string', minLength: 1 },
    iconName: { type: ['string', 'null'] },
    iconWeight: { type: ['string', 'null'] },
  },
} as const;

const patchBody = {
  type: 'object',
  properties: {
    name: { type: 'string', minLength: 1 },
    slug: { type: 'string', minLength: 1 },
    iconName: { type: ['string', 'null'] },
    iconWeight: { type: ['string', 'null'] },
  },
} as const;

const serialize = (row: {
  id: string;
  worldId: string;
  name: string;
  slug: string;
  iconName: string | null;
  iconWeight: string | null;
}) => ({
  id: row.id,
  worldId: row.worldId,
  name: row.name,
  slug: row.slug,
  iconName: row.iconName,
  iconWeight: row.iconWeight,
});

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === 'P2002';
}

type WriteBody = {
  name?: string;
  slug?: string;
  iconName?: string | null;
  iconWeight?: string | null;
};

function buildData(body: WriteBody): Record<string, unknown> {
  return {
    ...(body.name !== undefined ? { name: body.name } : {}),
    ...(body.slug !== undefined ? { slug: body.slug } : {}),
    ...(body.iconName !== undefined ? { iconName: body.iconName } : {}),
    ...(body.iconWeight !== undefined ? { iconWeight: body.iconWeight } : {}),
  };
}

export function entryTypeRoutes(app: FastifyInstance): void {
  app.post<{ Params: { worldId: string }; Body: WriteBody }>(
    '/worlds/:worldId/entry-types',
    { schema: { body: createBody } },
    async (req, reply) => {
      const world = await app.prisma.world.findUnique({ where: { id: req.params.worldId } });
      if (!world) throw notFound('world', req.params.worldId);
      try {
        const row = await app.prisma.entryType.create({
          data: { ...buildData(req.body), worldId: world.id } as any,
        });
        return reply.code(201).send(serialize(row));
      } catch (err) {
        if (isUniqueViolation(err)) {
          throw conflict(`an entry type with slug '${req.body.slug}' already exists in this world`);
        }
        throw err;
      }
    }
  );

  app.get<{ Params: { worldId: string } }>('/worlds/:worldId/entry-types', async (req) => {
    const world = await app.prisma.world.findUnique({ where: { id: req.params.worldId } });
    if (!world) throw notFound('world', req.params.worldId);
    const rows = await app.prisma.entryType.findMany({
      where: { worldId: world.id },
      orderBy: { name: 'asc' },
    });
    return { items: rows.map(serialize), nextCursor: null };
  });

  app.get<{ Params: { id: string } }>('/entry-types/:id', async (req) => {
    const row = await app.prisma.entryType.findUnique({ where: { id: req.params.id } });
    if (!row) throw notFound('entry type', req.params.id);
    return serialize(row);
  });

  app.patch<{ Params: { id: string }; Body: WriteBody }>(
    '/entry-types/:id',
    { schema: { body: patchBody } },
    async (req) => {
      const existing = await app.prisma.entryType.findUnique({ where: { id: req.params.id } });
      if (!existing) throw notFound('entry type', req.params.id);
      try {
        const row = await app.prisma.entryType.update({
          where: { id: existing.id },
          data: buildData(req.body),
        });
        return serialize(row);
      } catch (err) {
        if (isUniqueViolation(err)) {
          throw conflict(`an entry type with slug '${req.body.slug}' already exists in this world`);
        }
        throw err;
      }
    }
  );

  app.delete<{ Params: { id: string } }>('/entry-types/:id', async (req, reply) => {
    const row = await app.prisma.entryType.findUnique({ where: { id: req.params.id } });
    if (!row) throw notFound('entry type', req.params.id);
    const count = await app.prisma.entry.count({ where: { typeId: row.id } });
    if (count > 0) {
      throw inUse(`entry type is referenced by ${count} existing entry/entries`);
    }
    await app.prisma.entryType.delete({ where: { id: row.id } });
    return reply.code(204).send();
  });
}
