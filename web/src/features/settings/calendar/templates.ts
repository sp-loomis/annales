// Seed definitions offered when creating a calendar. GREGORIAN mirrors the
// backend reference fixture (Julian %4 leap rule, custom BC/AD formatting,
// tick-derived weekday). MINIMAL is a bare two-level starting point.

import type { CalendarDefinition } from "../../../api/types";

export const MINIMAL: CalendarDefinition = {
  version: 1,
  params: [
    { name: "year", type: "number", range: { from: 1, to: 9999 }, step: 1 },
    { name: "day", type: "number", range: { from: 1, to: 365 }, unitTicks: 1 },
  ],
  epoch: { year: 1, day: 1 },
};

export const GREGORIAN: CalendarDefinition = {
  version: 1,
  params: [
    { name: "year", type: "number", range: { from: -9999, to: 9999 }, step: 1 },
    {
      name: "month",
      type: "named",
      values: [
        "January",
        "February",
        "March",
        "April",
        "May",
        "June",
        "July",
        "August",
        "September",
        "October",
        "November",
        "December",
      ],
    },
    {
      name: "day",
      type: "number",
      range: {
        from: 1,
        to: {
          dsl:
            "leap := year % 4 = 0\n" +
            "return case month when February then (if leap then 29 else 28) " +
            "when April, June, September, November then 30 else 31",
        },
      },
      unitTicks: 1,
    },
  ],
  epoch: { year: 1, month: "January", day: 1 },
  derivedFields: [
    {
      name: "weekday",
      type: "named",
      values: ["Saturday", "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
      expr: { dsl: "return tick % 7" },
    },
  ],
  format: {
    pretty: {
      day: {
        dsl:
          "bcyear := 1 - year\n" +
          'return if year >= 1 then "{month} {day}, {year} AD" else "{month} {day}, {bcyear} BC"',
      },
    },
    short: {
      day: { dsl: 'return "{year}/{ordinal(month):02d}/{day:02d}"' },
    },
  },
};

export interface Template {
  key: string;
  label: string;
  definition: CalendarDefinition;
}

export const TEMPLATES: Template[] = [
  { key: "minimal", label: "Minimal (year / day)", definition: MINIMAL },
  { key: "gregorian", label: "Gregorian (leap years, weekday)", definition: GREGORIAN },
];
