import type { FastifyInstance } from 'fastify';
import { crossWorld, notFound, validation } from '../lib/errors.js';
import { CalendarError, computeTicks } from '../lib/calendar.js';

const PRECISION_TIERS = ['exact', 'circa', 'ordinal'];

function serialize(row: any) {
  return {
    id: row.id,
    entryId: row.entryId,
    calendarId: row.calendarId,
    rawComponents: row.rawComponents,
    tickStart: row.tickStart,
    tickEnd: row.tickEnd,
    precisionTier: row.precisionTier,
  };
}

function ticksFor(calendar: { type: string; definition: unknown }, raw: Record<string, unknown>) {
  try {
    return computeTicks(calendar, raw);
  } catch (err) {
    if (err instanceof CalendarError) throw validation(err.message);
    throw err;
  }
}

export function dateRangeRoutes(app: FastifyInstance): void {
  app.post<{
    Params: { entryId: string };
    Body: { calendarId: string; rawComponents: Record<string, unknown>; precisionTier: string };
  }>(
    '/entries/:entryId/date-ranges',
    {
      schema: {
        body: {
          type: 'object',
          required: ['calendarId', 'rawComponents', 'precisionTier'],
          properties: {
            calendarId: { type: 'string', minLength: 1 },
            rawComponents: { type: 'object' },
            precisionTier: { enum: PRECISION_TIERS },
          },
        },
      },
    },
    async (req, reply) => {
      const entry = await app.prisma.entry.findUnique({ where: { id: req.params.entryId } });
      if (!entry) throw notFound('entry', req.params.entryId);
      const calendar = await app.prisma.calendar.findUnique({
        where: { id: req.body.calendarId },
      });
      if (!calendar) throw notFound('calendar', req.body.calendarId);
      if (calendar.worldId !== entry.worldId) {
        throw crossWorld('calendar belongs to a different world than the entry');
      }

      const ticks = ticksFor(calendar, req.body.rawComponents);
      const row = await app.prisma.dateRange.create({
        data: {
          entryId: entry.id,
          calendarId: calendar.id,
          rawComponents: req.body.rawComponents as object,
          precisionTier: req.body.precisionTier,
          tickStart: ticks.tickStart,
          tickEnd: ticks.tickEnd,
        },
      });
      return reply.code(201).send(serialize(row));
    }
  );

  app.patch<{
    Params: { id: string };
    Body: {
      calendarId?: string;
      rawComponents?: Record<string, unknown>;
      precisionTier?: string;
    };
  }>(
    '/date-ranges/:id',
    {
      schema: {
        body: {
          type: 'object',
          properties: {
            calendarId: { type: 'string', minLength: 1 },
            rawComponents: { type: 'object' },
            precisionTier: { enum: PRECISION_TIERS },
          },
        },
      },
    },
    async (req) => {
      const existing = await app.prisma.dateRange.findUnique({
        where: { id: req.params.id },
        include: { entry: true },
      });
      if (!existing) throw notFound('date range', req.params.id);

      const calendarId = req.body.calendarId ?? existing.calendarId;
      const calendar = await app.prisma.calendar.findUnique({ where: { id: calendarId } });
      if (!calendar) throw notFound('calendar', calendarId);
      if (calendar.worldId !== existing.entry.worldId) {
        throw crossWorld('calendar belongs to a different world than the entry');
      }

      const rawComponents =
        req.body.rawComponents ?? (existing.rawComponents as Record<string, unknown>);
      const ticks = ticksFor(calendar, rawComponents);
      const row = await app.prisma.dateRange.update({
        where: { id: existing.id },
        data: {
          calendarId: calendar.id,
          rawComponents: rawComponents as object,
          precisionTier: req.body.precisionTier ?? existing.precisionTier,
          tickStart: ticks.tickStart,
          tickEnd: ticks.tickEnd,
        },
      });
      return serialize(row);
    }
  );

  app.delete<{ Params: { id: string } }>('/date-ranges/:id', async (req, reply) => {
    const existing = await app.prisma.dateRange.findUnique({ where: { id: req.params.id } });
    if (!existing) throw notFound('date range', req.params.id);
    await app.prisma.dateRange.delete({ where: { id: existing.id } });
    return reply.code(204).send();
  });
}
