import type { FastifyInstance } from "fastify";
import { notFound } from "../lib/errors.js";

// Per-world UI theme. One row keyed by worldId. GET never 404s on a missing row
// — it returns the column defaults; PUT upserts. (A missing world still 404s.)

type ThemeRow = {
  worldId: string;
  fontFamily: string | null;
  accentColor: string | null;
  surfaceColor: string | null;
  darkMode: boolean;
  defaultIconWeight: string;
  uiScale: string;
};

const UI_SCALES = ["small", "medium", "large"] as const;

const defaults = (worldId: string): ThemeRow => ({
  worldId,
  fontFamily: null,
  accentColor: null,
  surfaceColor: null,
  darkMode: true,
  defaultIconWeight: "duotone",
  uiScale: "small",
});

const serialize = (row: ThemeRow) => ({
  worldId: row.worldId,
  fontFamily: row.fontFamily,
  accentColor: row.accentColor,
  surfaceColor: row.surfaceColor,
  darkMode: row.darkMode,
  defaultIconWeight: row.defaultIconWeight,
  uiScale: row.uiScale,
});

const putBody = {
  type: "object",
  properties: {
    fontFamily: { type: ["string", "null"] },
    accentColor: { type: ["string", "null"] },
    surfaceColor: { type: ["string", "null"] },
    darkMode: { type: "boolean" },
    defaultIconWeight: { type: "string", minLength: 1 },
    uiScale: { enum: UI_SCALES },
  },
} as const;

type PutBody = {
  fontFamily?: string | null;
  accentColor?: string | null;
  surfaceColor?: string | null;
  darkMode?: boolean;
  defaultIconWeight?: string;
  uiScale?: (typeof UI_SCALES)[number];
};

export function worldThemeRoutes(app: FastifyInstance): void {
  app.get<{ Params: { worldId: string } }>("/worlds/:worldId/theme", async (req) => {
    const world = await app.prisma.world.findUnique({ where: { id: req.params.worldId } });
    if (!world) throw notFound("world", req.params.worldId);
    const row = await app.prisma.worldTheme.findUnique({ where: { worldId: world.id } });
    return serialize(row ?? defaults(world.id));
  });

  app.put<{ Params: { worldId: string }; Body: PutBody }>(
    "/worlds/:worldId/theme",
    { schema: { body: putBody } },
    async (req) => {
      const world = await app.prisma.world.findUnique({ where: { id: req.params.worldId } });
      if (!world) throw notFound("world", req.params.worldId);
      const data = {
        ...(req.body.fontFamily !== undefined ? { fontFamily: req.body.fontFamily } : {}),
        ...(req.body.accentColor !== undefined ? { accentColor: req.body.accentColor } : {}),
        ...(req.body.surfaceColor !== undefined ? { surfaceColor: req.body.surfaceColor } : {}),
        ...(req.body.darkMode !== undefined ? { darkMode: req.body.darkMode } : {}),
        ...(req.body.defaultIconWeight !== undefined
          ? { defaultIconWeight: req.body.defaultIconWeight }
          : {}),
        ...(req.body.uiScale !== undefined ? { uiScale: req.body.uiScale } : {}),
      };
      const row = await app.prisma.worldTheme.upsert({
        where: { worldId: world.id },
        create: { worldId: world.id, ...data },
        update: data,
      });
      return serialize(row);
    }
  );
}
