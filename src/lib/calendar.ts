// Tick = fractional day count since the world epoch. See docs/API.md appendix.

export class CalendarError extends Error {}

export interface Ticks {
  tickStart: number | null;
  tickEnd: number | null;
}

interface ArithmeticMonth {
  name: string;
  days: number;
}

interface OrdinalStage {
  name: string;
  tickStart?: number;
  tickEnd?: number;
}

export function validateCalendarDefinition(type: string, definition: unknown): void {
  if (type === 'arithmetic') {
    const months = (definition as { months?: unknown })?.months;
    if (!Array.isArray(months) || months.length === 0) {
      throw new CalendarError('arithmetic calendar needs a non-empty months array');
    }
    for (const m of months as ArithmeticMonth[]) {
      if (typeof m?.name !== 'string' || !Number.isFinite(m?.days) || m.days <= 0) {
        throw new CalendarError('each month needs a name and a positive day count');
      }
    }
    return;
  }
  if (type === 'ordinal') {
    const stages = (definition as { stages?: unknown })?.stages;
    if (!Array.isArray(stages) || stages.length === 0) {
      throw new CalendarError('ordinal calendar needs a non-empty stages array');
    }
    for (const s of stages as OrdinalStage[]) {
      if (typeof s?.name !== 'string') throw new CalendarError('each stage needs a name');
    }
    return;
  }
  if (type === 'table') {
    throw new CalendarError("calendar type 'table' is reserved and not supported in v1");
  }
  throw new CalendarError(`unknown calendar type '${type}'`);
}

export function computeTicks(
  calendar: { type: string; definition: unknown },
  rawComponents: Record<string, unknown>
): Ticks {
  if (calendar.type === 'arithmetic') {
    return arithmeticTicks(calendar.definition as { months: ArithmeticMonth[] }, rawComponents);
  }
  if (calendar.type === 'ordinal') {
    return ordinalTicks(calendar.definition as { stages: OrdinalStage[] }, rawComponents);
  }
  throw new CalendarError(`unknown calendar type '${calendar.type}'`);
}

function arithmeticTicks(
  definition: { months: ArithmeticMonth[] },
  raw: Record<string, unknown>
): Ticks {
  const { year, month, day } = raw as { year?: unknown; month?: unknown; day?: unknown };
  if (!Number.isInteger(year)) throw new CalendarError('rawComponents.year (integer) is required');
  if (day !== undefined && month === undefined) {
    throw new CalendarError('rawComponents.day requires rawComponents.month');
  }

  const months = definition.months;
  const yearLength = months.reduce((sum, m) => sum + m.days, 0);
  const yearStart = ((year as number) - 1) * yearLength;

  if (month === undefined) {
    return { tickStart: yearStart, tickEnd: yearStart + yearLength };
  }

  if (!Number.isInteger(month) || (month as number) < 1 || (month as number) > months.length) {
    throw new CalendarError(`month must be an integer between 1 and ${months.length}`);
  }
  const monthIndex = (month as number) - 1;
  const monthStart =
    yearStart + months.slice(0, monthIndex).reduce((sum, m) => sum + m.days, 0);
  const monthDays = months[monthIndex].days;

  if (day === undefined) {
    return { tickStart: monthStart, tickEnd: monthStart + monthDays };
  }

  if (!Number.isInteger(day) || (day as number) < 1 || (day as number) > monthDays) {
    throw new CalendarError(
      `day must be an integer between 1 and ${monthDays} for month ${month}`
    );
  }
  const dayStart = monthStart + ((day as number) - 1);
  return { tickStart: dayStart, tickEnd: dayStart + 1 };
}

function ordinalTicks(
  definition: { stages: OrdinalStage[] },
  raw: Record<string, unknown>
): Ticks {
  const stageName = (raw as { stage?: unknown }).stage;
  if (typeof stageName !== 'string') {
    throw new CalendarError('rawComponents.stage (string) is required');
  }
  const stage = definition.stages.find((s) => s.name === stageName);
  if (!stage) throw new CalendarError(`unknown stage '${stageName}'`);
  return { tickStart: stage.tickStart ?? null, tickEnd: stage.tickEnd ?? null };
}
