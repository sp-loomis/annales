import type { FastifyInstance } from 'fastify';
import { crossWorld, notFound, validation } from '../lib/errors.js';
import { CalendarError, compileCalendar, dateToTicks, type Ticks } from '../lib/calendar/index.js';

const PRECISION_TIERS = ['exact', 'circa', 'ordinal'];
const DISPLAY_STYLES = ['pretty', 'short'];

function serialize(row: any) {
  return {
    id: row.id,
    entryId: row.entryId,
    calendarId: row.calendarId,
    rawComponents: row.rawComponents,
    // BigInt columns: convert for JSON; safe-integer range enforced at write.
    tickStart: row.tickStart === null ? null : Number(row.tickStart),
    tickEnd: row.tickEnd === null ? null : Number(row.tickEnd),
    precisionTier: row.precisionTier,
    label: row.label,
    displayStyle: row.displayStyle,
  };
}

function ticksFor(definition: unknown, raw: Record<string, unknown>): Ticks {
  try {
    return dateToTicks(compileCalendar(definition), raw);
  } catch (err) {
    if (err instanceof CalendarError) throw validation(err.message);
    throw err;
  }
}

export function dateRangeRoutes(app: FastifyInstance): void {
  app.post<{
    Params: { entryId: string };
    Body: {
      calendarId: string;
      rawComponents: Record<string, unknown>;
      precisionTier: string;
      label?: string | null;
      displayStyle?: string;
    };
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
            label: { type: ['string', 'null'] },
            displayStyle: { enum: DISPLAY_STYLES },
          },
        },
      },
    },
    async (req, reply) => {
      const entry = await app.prisma.entry.findUnique({ where: { id: req.params.entryId } });
      if (!entry) throw notFound('entry', req.params.entryId);
      const calendar = await app.prisma.calendar.findUnique({
        where: { id: req.body.calendarId },
        include: { timeline: true },
      });
      if (!calendar) throw notFound('calendar', req.body.calendarId);
      if (calendar.timeline.worldId !== entry.worldId) {
        throw crossWorld('calendar belongs to a different world than the entry');
      }

      const ticks = ticksFor(calendar.definition, req.body.rawComponents);
      const row = await app.prisma.dateRange.create({
        data: {
          entryId: entry.id,
          calendarId: calendar.id,
          rawComponents: req.body.rawComponents as object,
          precisionTier: req.body.precisionTier,
          tickStart: ticks.tickStart,
          tickEnd: ticks.tickEnd,
          label: req.body.label ?? null,
          ...(req.body.displayStyle !== undefined ? { displayStyle: req.body.displayStyle } : {}),
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
      label?: string | null;
      displayStyle?: string;
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
            label: { type: ['string', 'null'] },
            displayStyle: { enum: DISPLAY_STYLES },
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
      const calendar = await app.prisma.calendar.findUnique({
        where: { id: calendarId },
        include: { timeline: true },
      });
      if (!calendar) throw notFound('calendar', calendarId);
      if (calendar.timeline.worldId !== existing.entry.worldId) {
        throw crossWorld('calendar belongs to a different world than the entry');
      }

      const rawComponents =
        req.body.rawComponents ?? (existing.rawComponents as Record<string, unknown>);
      const ticks = ticksFor(calendar.definition, rawComponents);
      const row = await app.prisma.dateRange.update({
        where: { id: existing.id },
        data: {
          calendarId: calendar.id,
          rawComponents: rawComponents as object,
          precisionTier: req.body.precisionTier ?? existing.precisionTier,
          tickStart: ticks.tickStart,
          tickEnd: ticks.tickEnd,
          ...(req.body.label !== undefined ? { label: req.body.label } : {}),
          ...(req.body.displayStyle !== undefined ? { displayStyle: req.body.displayStyle } : {}),
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
