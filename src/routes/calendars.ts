import type { FastifyInstance } from 'fastify';
import { notFound, validation } from '../lib/errors.js';
import {
  CalendarError,
  compileCalendar,
  computeDerived,
  dateToTicks,
  formatDate,
  tickToDate,
  type DateTuple,
} from '../lib/calendar/index.js';

export function calendarRoutes(app: FastifyInstance): void {
  app.post<{
    Params: { id: string };
    Body: { tick?: number; date?: Record<string, unknown> };
  }>(
    '/calendars/:id/convert',
    {
      schema: {
        body: {
          type: 'object',
          properties: {
            tick: { type: 'integer' },
            date: { type: 'object' },
          },
        },
      },
    },
    async (req) => {
      const { tick, date } = req.body ?? {};
      if ((tick === undefined) === (date === undefined)) {
        throw validation("provide exactly one of 'tick' or 'date'");
      }
      const calendar = await app.prisma.calendar.findUnique({ where: { id: req.params.id } });
      if (!calendar) throw notFound('calendar', req.params.id);

      try {
        const compiled = compileCalendar(calendar.definition);
        const resolved: DateTuple =
          tick !== undefined
            ? tickToDate(compiled, tick)
            : (() => {
                // dateToTicks below validates the prefix; narrow the type here.
                return date as DateTuple;
              })();
        const ticks = dateToTicks(compiled, resolved);
        const isFull = Object.keys(resolved).length === compiled.params.length;
        return {
          date: resolved,
          tickStart: ticks.tickStart,
          tickEnd: ticks.tickEnd,
          pretty: formatDate(compiled, resolved, 'pretty', ticks.tickStart),
          short: formatDate(compiled, resolved, 'short', ticks.tickStart),
          // Derived fields need a tick, so they exist only for full tuples
          // (always finite: the terminal unit's width is never open-ended).
          ...(isFull ? { derived: computeDerived(compiled, resolved, ticks.tickStart!) } : {}),
        };
      } catch (err) {
        if (err instanceof CalendarError) throw validation(err.message);
        throw err;
      }
    }
  );
}
