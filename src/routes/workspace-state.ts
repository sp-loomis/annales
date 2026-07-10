import { Prisma } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { notFound } from '../lib/errors.js';

// Per-world workspace state (open tabs, sidebar prefs). One row keyed by
// worldId. GET returns empty defaults on a missing row; PUT upserts. Client
// autosaves; no explicit user action.

type StateRow = {
  worldId: string;
  openEntryIds: string[];
  sidebarState: unknown;
  updatedAt: Date | null;
};

const serialize = (row: StateRow) => ({
  worldId: row.worldId,
  openEntryIds: row.openEntryIds,
  sidebarState: row.sidebarState ?? null,
  updatedAt: row.updatedAt ? row.updatedAt.toISOString() : null,
});

const putBody = {
  type: 'object',
  properties: {
    openEntryIds: { type: 'array', items: { type: 'string' } },
    sidebarState: { type: ['object', 'null'] },
  },
} as const;

type PutBody = { openEntryIds?: string[]; sidebarState?: object | null };

export function workspaceStateRoutes(app: FastifyInstance): void {
  app.get<{ Params: { worldId: string } }>('/worlds/:worldId/workspace-state', async (req) => {
    const world = await app.prisma.world.findUnique({ where: { id: req.params.worldId } });
    if (!world) throw notFound('world', req.params.worldId);
    const row = await app.prisma.workspaceState.findUnique({ where: { worldId: world.id } });
    return serialize(
      row ?? { worldId: world.id, openEntryIds: [], sidebarState: null, updatedAt: null }
    );
  });

  app.put<{ Params: { worldId: string }; Body: PutBody }>(
    '/worlds/:worldId/workspace-state',
    { schema: { body: putBody } },
    async (req) => {
      const world = await app.prisma.world.findUnique({ where: { id: req.params.worldId } });
      if (!world) throw notFound('world', req.params.worldId);
      const data = {
        ...(req.body.openEntryIds !== undefined ? { openEntryIds: req.body.openEntryIds } : {}),
        ...(req.body.sidebarState !== undefined
          ? { sidebarState: req.body.sidebarState === null ? Prisma.DbNull : req.body.sidebarState }
          : {}),
      };
      const row = await app.prisma.workspaceState.upsert({
        where: { worldId: world.id },
        create: { worldId: world.id, openEntryIds: req.body.openEntryIds ?? [], ...data },
        update: data,
      });
      return serialize(row);
    }
  );
}
