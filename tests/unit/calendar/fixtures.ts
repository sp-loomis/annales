// Reference calendar definitions used across unit and contract tests.
// GREGORIAN: simplified (Julian %4 leap rule), bounded years, custom formatting,
// a tick-derived weekday. LONG_RECKONING: structural BC/AD Named era with Null
// (open-ended) year bounds and countdown BC years.

export const GREGORIAN = {
  version: 1,
  params: [
    { name: 'year', type: 'number', range: { from: -9999, to: 9999 }, step: 1 },
    {
      name: 'month',
      type: 'named',
      values: [
        'January',
        'February',
        'March',
        'April',
        'May',
        'June',
        'July',
        'August',
        'September',
        'October',
        'November',
        'December',
      ],
    },
    {
      name: 'day',
      type: 'number',
      range: {
        from: 1,
        to: {
          dsl:
            'leap := year % 4 = 0\n' +
            'return case month when February then (if leap then 29 else 28) ' +
            'when April, June, September, November then 30 else 31',
        },
      },
      unitTicks: 1,
    },
  ],
  epoch: { year: 1, month: 'January', day: 1 },
  derivedFields: [
    {
      name: 'weekday',
      type: 'named',
      values: ['Saturday', 'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
      expr: { dsl: 'return tick % 7' },
    },
  ],
  format: {
    pretty: {
      day: {
        dsl:
          'bcyear := 1 - year\n' +
          'return if year >= 1 then "{month} {day}, {year} AD" else "{month} {day}, {bcyear} BC"',
      },
    },
    short: {
      day: { dsl: 'return "{year}/{ordinal(month):02d}/{day:02d}"' },
    },
  },
};

export const LONG_RECKONING = {
  version: 1,
  params: [
    { name: 'era', type: 'named', values: ['BC', 'AD'], step: 1 },
    {
      name: 'year',
      type: 'number',
      range: {
        from: { dsl: 'return case era when BC then null when AD then 1' },
        to: { dsl: 'return case era when BC then 1 when AD then null' },
      },
      step: { dsl: 'return case era when BC then -1 when AD then 1' },
    },
    { name: 'month', type: 'named', values: ['Frostwane', 'Sunreach'] },
    { name: 'day', type: 'number', range: { from: 1, to: 30 }, unitTicks: 1 },
  ],
  epoch: { era: 'AD', year: 1, month: 'Frostwane', day: 1 },
};

/** Deep-clone a fixture and apply a patch function to the copy. */
export function variant<T>(fixture: T, patch: (copy: any) => void): T {
  const copy = JSON.parse(JSON.stringify(fixture));
  patch(copy);
  return copy;
}
