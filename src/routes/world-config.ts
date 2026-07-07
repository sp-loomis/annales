import type { FastifyInstance } from 'fastify';
import { conflict, inUse, notFound, validation } from '../lib/errors.js';
import { CalendarError, validateCalendarDefinition } from '../lib/calendar.js';

// CRS definitions, calendars, and relation types share one shape: per-world
// config rows with a per-world unique name and an IN_USE guard on delete.

interface ConfigResource {
  collection: string;
  noun: string;
  delegate: (app: FastifyInstance) => any;
  bodySchema: (partial: boolean) => object;
  /** Validate + shape the write payload. Throws AppError. */
  buildData: (body: any) => Record<string, unknown>;
  serialize: (row: any) => Record<string, unknown>;
  inUseCount: (app: FastifyInstance, id: string) => Promise<number>;
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === 'P2002';
}

const RESOURCES: ConfigResource[] = [
  {
    collection: 'crs',
    noun: 'CRS definition',
    delegate: (app) => app.prisma.crsDefinition,
    bodySchema: (partial) => ({
      type: 'object',
      ...(partial ? {} : { required: ['name', 'params'] }),
      properties: { name: { type: 'string', minLength: 1 }, params: { type: 'object' } },
    }),
    buildData: (body) => ({
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.params !== undefined ? { params: body.params } : {}),
    }),
    serialize: (row) => ({ id: row.id, worldId: row.worldId, name: row.name, params: row.params }),
    inUseCount: (app, id) => app.prisma.geometry.count({ where: { crsId: id } }),
  },
  {
    collection: 'calendars',
    noun: 'calendar',
    delegate: (app) => app.prisma.calendar,
    bodySchema: (partial) => ({
      type: 'object',
      ...(partial ? {} : { required: ['name', 'type', 'definition'] }),
      properties: {
        name: { type: 'string', minLength: 1 },
        type: { type: 'string', minLength: 1 },
        definition: { type: 'object' },
      },
    }),
    buildData: (body) => {
      if (body.type !== undefined || body.definition !== undefined) {
        // type/definition always validated together
        try {
          validateCalendarDefinition(body.type, body.definition);
        } catch (err) {
          if (err instanceof CalendarError) throw validation(err.message);
          throw err;
        }
      }
      return {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.type !== undefined ? { type: body.type } : {}),
        ...(body.definition !== undefined ? { definition: body.definition } : {}),
      };
    },
    serialize: (row) => ({
      id: row.id,
      worldId: row.worldId,
      name: row.name,
      type: row.type,
      definition: row.definition,
    }),
    inUseCount: (app, id) => app.prisma.dateRange.count({ where: { calendarId: id } }),
  },
  {
    collection: 'relation-types',
    noun: 'relation type',
    delegate: (app) => app.prisma.relationType,
    bodySchema: (partial) => ({
      type: 'object',
      ...(partial ? {} : { required: ['name'] }),
      properties: {
        name: { type: 'string', minLength: 1 },
        inverseName: { type: ['string', 'null'] },
      },
    }),
    buildData: (body) => ({
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.inverseName !== undefined ? { inverseName: body.inverseName } : {}),
    }),
    serialize: (row) => ({
      id: row.id,
      worldId: row.worldId,
      name: row.name,
      inverseName: row.inverseName,
    }),
    inUseCount: (app, id) => app.prisma.relation.count({ where: { typeId: id } }),
  },
];

function register(app: FastifyInstance, res: ConfigResource): void {
  app.post<{ Params: { worldId: string }; Body: any }>(
    `/worlds/:worldId/${res.collection}`,
    { schema: { body: res.bodySchema(false) } },
    async (req, reply) => {
      const body = req.body as Record<string, any>;
      const world = await app.prisma.world.findUnique({ where: { id: req.params.worldId } });
      if (!world) throw notFound('world', req.params.worldId);
      const data = res.buildData(body);
      try {
        const row = await res.delegate(app).create({ data: { ...data, worldId: world.id } });
        return reply.code(201).send(res.serialize(row));
      } catch (err) {
        if (isUniqueViolation(err)) {
          throw conflict(`a ${res.noun} named '${body.name}' already exists in this world`);
        }
        throw err;
      }
    }
  );

  app.get<{ Params: { worldId: string } }>(`/worlds/:worldId/${res.collection}`, async (req) => {
    const world = await app.prisma.world.findUnique({ where: { id: req.params.worldId } });
    if (!world) throw notFound('world', req.params.worldId);
    const rows = await res.delegate(app).findMany({
      where: { worldId: world.id },
      orderBy: { name: 'asc' },
    });
    return { items: rows.map(res.serialize), nextCursor: null };
  });

  app.get<{ Params: { id: string } }>(`/${res.collection}/:id`, async (req) => {
    const row = await res.delegate(app).findUnique({ where: { id: req.params.id } });
    if (!row) throw notFound(res.noun, req.params.id);
    return res.serialize(row);
  });

  app.patch<{ Params: { id: string }; Body: any }>(
    `/${res.collection}/:id`,
    { schema: { body: res.bodySchema(true) } },
    async (req) => {
      const body = req.body as Record<string, any>;
      const existing = await res.delegate(app).findUnique({ where: { id: req.params.id } });
      if (!existing) throw notFound(res.noun, req.params.id);
      // calendars: type/definition must stay coherent — validate the merged row
      const merged = { ...existing, ...body };
      const data = res.buildData(
        res.collection === 'calendars'
          ? { ...body, type: merged.type, definition: merged.definition }
          : body
      );
      try {
        const row = await res.delegate(app).update({ where: { id: existing.id }, data });
        return res.serialize(row);
      } catch (err) {
        if (isUniqueViolation(err)) {
          throw conflict(`a ${res.noun} named '${body.name}' already exists in this world`);
        }
        throw err;
      }
    }
  );

  app.delete<{ Params: { id: string } }>(`/${res.collection}/:id`, async (req, reply) => {
    const row = await res.delegate(app).findUnique({ where: { id: req.params.id } });
    if (!row) throw notFound(res.noun, req.params.id);
    const count = await res.inUseCount(app, row.id);
    if (count > 0) {
      throw inUse(`${res.noun} is referenced by ${count} existing record(s)`);
    }
    await res.delegate(app).delete({ where: { id: row.id } });
    return reply.code(204).send();
  });
}

export function worldConfigRoutes(app: FastifyInstance): void {
  for (const res of RESOURCES) register(app, res);
}
