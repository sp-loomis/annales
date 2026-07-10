import type { FastifyInstance } from "fastify";
import { notFound, validation } from "../lib/errors.js";
import { deriveStatus, getBboxes, thumbKeyFor } from "../lib/artifact-util.js";
import { dropEntryIndex } from "../lib/search-index.js";
import { relationsView } from "../lib/relations-view.js";

type EntryWithTags = {
  id: string;
  worldId: string;
  type: { slug: string };
  title: string;
  createdAt: Date;
  updatedAt: Date;
  tags: { tag: string }[];
};

function summary(entry: EntryWithTags) {
  return {
    id: entry.id,
    worldId: entry.worldId,
    // API exposes the human-readable slug; typeId (uuid) stays internal.
    type: entry.type.slug,
    title: entry.title,
    tags: entry.tags.map((t) => t.tag).sort(),
    createdAt: entry.createdAt.toISOString(),
    updatedAt: entry.updatedAt.toISOString(),
  };
}

// Resolve a type slug to an EntryType id within the world (strict FK):
// unknown slug → 400 VALIDATION. Caller must have verified the world exists.
async function resolveTypeId(app: FastifyInstance, worldId: string, slug: string): Promise<string> {
  const type = await app.prisma.entryType.findUnique({
    where: { worldId_slug: { worldId, slug } },
  });
  if (!type) throw validation(`unknown entry type '${slug}' for this world`);
  return type.id;
}

const createBody = {
  type: "object",
  required: ["type", "title"],
  properties: {
    type: { type: "string", minLength: 1 },
    title: { type: "string", minLength: 1 },
    tags: { type: "array", items: { type: "string", minLength: 1 } },
  },
} as const;

export function entryRoutes(app: FastifyInstance): void {
  app.post<{ Params: { worldId: string }; Body: { type: string; title: string; tags?: string[] } }>(
    "/worlds/:worldId/entries",
    { schema: { body: createBody } },
    async (req, reply) => {
      const world = await app.prisma.world.findUnique({ where: { id: req.params.worldId } });
      if (!world) throw notFound("world", req.params.worldId);
      const typeId = await resolveTypeId(app, world.id, req.body.type);
      const tags = [...new Set(req.body.tags ?? [])];
      const entry = await app.prisma.entry.create({
        data: {
          worldId: world.id,
          typeId,
          title: req.body.title,
          tags: { create: tags.map((tag) => ({ tag })) },
        },
        include: { tags: true, type: true },
      });
      return reply.code(201).send(summary(entry));
    }
  );

  app.get<{
    Params: { worldId: string };
    Querystring: { type?: string; tag?: string; limit?: number; cursor?: string };
  }>(
    "/worlds/:worldId/entries",
    {
      schema: {
        querystring: {
          type: "object",
          properties: {
            type: { type: "string" },
            tag: { type: "string" },
            limit: { type: "integer", minimum: 1, maximum: 200, default: 50 },
            cursor: { type: "string" },
          },
        },
      },
    },
    async (req) => {
      const { worldId } = req.params;
      const { type, tag, limit = 50, cursor } = req.query;
      const world = await app.prisma.world.findUnique({ where: { id: worldId } });
      if (!world) throw notFound("world", worldId);

      const entries = await app.prisma.entry.findMany({
        where: {
          worldId,
          ...(type ? { type: { slug: type } } : {}),
          ...(tag ? { tags: { some: { tag } } } : {}),
        },
        include: { tags: true, type: true },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });

      const hasMore = entries.length > limit;
      const page = hasMore ? entries.slice(0, limit) : entries;
      return {
        items: page.map(summary),
        nextCursor: hasMore ? page[page.length - 1].id : null,
      };
    }
  );

  app.get<{ Params: { entryId: string } }>("/entries/:entryId", async (req) => {
    const entry = await app.prisma.entry.findUnique({
      where: { id: req.params.entryId },
      include: {
        tags: true,
        type: true,
        sections: true,
        images: true,
        sketches: true,
        geometries: true,
        dateRanges: true,
      },
    });
    if (!entry) throw notFound("entry", req.params.entryId);

    const bboxes = await getBboxes(
      app.prisma,
      entry.geometries.map((g) => g.id)
    );

    const byOrder = <T extends { order: number }>(a: T, b: T) => a.order - b.order;

    return {
      ...summary(entry),
      sections: [...entry.sections].sort(byOrder).map((s) => ({
        id: s.id,
        order: s.order,
        contentJson: s.contentJson ?? null,
      })),
      images: [...entry.images].sort(byOrder).map((i) => ({
        id: i.id,
        label: i.label,
        order: i.order,
        status: deriveStatus(i),
      })),
      sketches: [...entry.sketches].sort(byOrder).map((s) => ({
        id: s.id,
        label: s.label,
        order: s.order,
        status: deriveStatus(s),
      })),
      geometries: [...entry.geometries].sort(byOrder).map((g) => ({
        id: g.id,
        crsId: g.crsId,
        label: g.label,
        order: g.order,
        status: deriveStatus(g),
        bboxes: bboxes.get(g.id) ?? [],
        properties: g.properties ?? null,
      })),
      dateRanges: entry.dateRanges.map((r) => ({
        id: r.id,
        calendarId: r.calendarId,
        rawComponents: r.rawComponents,
        // BigInt columns: convert for JSON; safe-integer range enforced at write.
        tickStart: r.tickStart === null ? null : Number(r.tickStart),
        tickEnd: r.tickEnd === null ? null : Number(r.tickEnd),
        precisionTier: r.precisionTier,
      })),
      relations: await relationsView(app.prisma, entry.id),
    };
  });

  app.patch<{ Params: { entryId: string }; Body: { type?: string; title?: string } }>(
    "/entries/:entryId",
    {
      schema: {
        body: {
          type: "object",
          properties: {
            type: { type: "string", minLength: 1 },
            title: { type: "string", minLength: 1 },
          },
        },
      },
    },
    async (req) => {
      const existing = await app.prisma.entry.findUnique({ where: { id: req.params.entryId } });
      if (!existing) throw notFound("entry", req.params.entryId);
      const typeId =
        req.body.type !== undefined
          ? await resolveTypeId(app, existing.worldId, req.body.type)
          : undefined;
      const entry = await app.prisma.entry.update({
        where: { id: existing.id },
        data: {
          ...(typeId !== undefined ? { typeId } : {}),
          ...(req.body.title !== undefined ? { title: req.body.title } : {}),
        },
        include: { tags: true, type: true },
      });
      return summary(entry);
    }
  );

  app.put<{ Params: { entryId: string }; Body: { tags: string[] } }>(
    "/entries/:entryId/tags",
    {
      schema: {
        body: {
          type: "object",
          required: ["tags"],
          properties: { tags: { type: "array", items: { type: "string", minLength: 1 } } },
        },
      },
    },
    async (req) => {
      const entry = await app.prisma.entry.findUnique({ where: { id: req.params.entryId } });
      if (!entry) throw notFound("entry", req.params.entryId);
      const tags = [...new Set(req.body.tags)];
      await app.prisma.$transaction([
        app.prisma.entryTag.deleteMany({ where: { entryId: entry.id } }),
        app.prisma.entryTag.createMany({ data: tags.map((tag) => ({ entryId: entry.id, tag })) }),
      ]);
      return { tags: tags.sort() };
    }
  );

  app.delete<{ Params: { entryId: string } }>("/entries/:entryId", async (req, reply) => {
    const entry = await app.prisma.entry.findUnique({
      where: { id: req.params.entryId },
      include: { images: true, sketches: true, geometries: true },
    });
    if (!entry) throw notFound("entry", req.params.entryId);

    // Sections are DB-only; only file-backed artifacts have storage keys.
    const keys = [
      ...entry.images.flatMap((i) => [i.filePath, thumbKeyFor(i.filePath)]),
      ...entry.sketches.map((s) => s.filePath),
      ...entry.geometries.map((g) => g.filePath),
    ];
    try {
      await app.store.deleteAll(keys);
    } catch (err) {
      req.log.warn({ err }, "storage cleanup failed during entry delete");
    }

    await dropEntryIndex(app.prisma, entry.id);
    await app.prisma.entry.delete({ where: { id: entry.id } });
    return reply.code(204).send();
  });
}
