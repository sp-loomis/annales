import { Prisma } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { conflict, crossWorld, notFound, validation } from '../lib/errors.js';

type Direction = 'out' | 'in' | 'both';

const directionSchema = { enum: ['out', 'in', 'both'], default: 'both' };

export function relationRoutes(app: FastifyInstance): void {
  app.post<{ Body: { fromId: string; toId: string; typeId: string } }>(
    '/relations',
    {
      schema: {
        body: {
          type: 'object',
          required: ['fromId', 'toId', 'typeId'],
          properties: {
            fromId: { type: 'string', minLength: 1 },
            toId: { type: 'string', minLength: 1 },
            typeId: { type: 'string', minLength: 1 },
          },
        },
      },
    },
    async (req, reply) => {
      const { fromId, toId, typeId } = req.body;
      if (fromId === toId) throw validation('a relation cannot point from an entry to itself');

      const [from, to, type] = await Promise.all([
        app.prisma.entry.findUnique({ where: { id: fromId } }),
        app.prisma.entry.findUnique({ where: { id: toId } }),
        app.prisma.relationType.findUnique({ where: { id: typeId } }),
      ]);
      if (!from) throw notFound('entry', fromId);
      if (!to) throw notFound('entry', toId);
      if (!type) throw notFound('relation type', typeId);
      if (from.worldId !== to.worldId) {
        throw crossWorld('entries belong to different worlds');
      }
      if (type.worldId !== from.worldId) {
        throw crossWorld('relation type belongs to a different world than the entries');
      }

      try {
        const row = await app.prisma.relation.create({ data: { fromId, toId, typeId } });
        return reply
          .code(201)
          .send({ id: row.id, fromId: row.fromId, toId: row.toId, typeId: row.typeId });
      } catch (err) {
        if ((err as { code?: string })?.code === 'P2002') {
          throw conflict('an identical relation already exists');
        }
        throw err;
      }
    }
  );

  app.get<{ Params: { entryId: string }; Querystring: { direction?: Direction; typeId?: string } }>(
    '/entries/:entryId/relations',
    {
      schema: {
        querystring: {
          type: 'object',
          properties: { direction: directionSchema, typeId: { type: 'string' } },
        },
      },
    },
    async (req) => {
      const { entryId } = req.params;
      const { direction = 'both', typeId } = req.query;
      const entry = await app.prisma.entry.findUnique({ where: { id: entryId } });
      if (!entry) throw notFound('entry', entryId);

      const directionWhere =
        direction === 'out'
          ? { fromId: entryId }
          : direction === 'in'
            ? { toId: entryId }
            : { OR: [{ fromId: entryId }, { toId: entryId }] };

      const rows = await app.prisma.relation.findMany({
        where: { ...directionWhere, ...(typeId ? { typeId } : {}) },
        include: { from: true, to: true, type: true },
      });

      return {
        items: rows.map((r) => {
          const other = r.fromId === entryId ? r.to : r.from;
          return {
            id: r.id,
            fromId: r.fromId,
            toId: r.toId,
            type: { id: r.type.id, name: r.type.name, inverseName: r.type.inverseName },
            otherEntry: { id: other.id, title: other.title, type: other.type },
          };
        }),
      };
    }
  );

  app.delete<{ Params: { id: string } }>('/relations/:id', async (req, reply) => {
    const existing = await app.prisma.relation.findUnique({ where: { id: req.params.id } });
    if (!existing) throw notFound('relation', req.params.id);
    await app.prisma.relation.delete({ where: { id: existing.id } });
    return reply.code(204).send();
  });

  app.get<{
    Params: { entryId: string };
    Querystring: { depth?: number; direction?: Direction; typeId?: string };
  }>(
    '/entries/:entryId/graph',
    {
      schema: {
        querystring: {
          type: 'object',
          properties: {
            depth: { type: 'integer', minimum: 1, maximum: 5, default: 1 },
            direction: directionSchema,
            typeId: { type: 'string' },
          },
        },
      },
    },
    async (req) => {
      const { entryId } = req.params;
      const { depth = 1, direction = 'both', typeId } = req.query;
      const entry = await app.prisma.entry.findUnique({ where: { id: entryId } });
      if (!entry) throw notFound('entry', entryId);

      const joinCond =
        direction === 'out'
          ? Prisma.raw('r."fromId" = w.id')
          : direction === 'in'
            ? Prisma.raw('r."toId" = w.id')
            : Prisma.raw('(r."fromId" = w.id OR r."toId" = w.id)');
      const typeCond = typeId ? Prisma.sql`AND r."typeId" = ${typeId}` : Prisma.empty;

      // Breadth-bounded walk; UNION dedupes (id, depth) pairs so cycles
      // terminate. MIN(depth) reports the shortest hop count per node.
      const reached = await app.prisma.$queryRaw<{ id: string; depth: number }[]>(Prisma.sql`
        WITH RECURSIVE walk(id, depth) AS (
          SELECT ${entryId}::text, 0
          UNION
          SELECT CASE WHEN r."fromId" = w.id THEN r."toId" ELSE r."fromId" END, w.depth + 1
          FROM walk w
          JOIN "Relation" r ON ${joinCond} ${typeCond}
          WHERE w.depth < ${depth}
        )
        SELECT id, MIN(depth)::int AS depth FROM walk GROUP BY id`);

      const depthOf = new Map(reached.map((r) => [r.id, r.depth]));
      const ids = [...depthOf.keys()];
      const [entries, edges] = await Promise.all([
        app.prisma.entry.findMany({ where: { id: { in: ids } } }),
        app.prisma.relation.findMany({
          where: {
            fromId: { in: ids },
            toId: { in: ids },
            ...(typeId ? { typeId } : {}),
          },
        }),
      ]);

      return {
        nodes: entries.map((e) => ({
          id: e.id,
          title: e.title,
          type: e.type,
          depth: depthOf.get(e.id) ?? 0,
        })),
        edges: edges.map((e) => ({
          id: e.id,
          fromId: e.fromId,
          toId: e.toId,
          typeId: e.typeId,
        })),
      };
    }
  );
}
