import { Prisma } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { notFound } from '../lib/errors.js';
import { extractProseMirrorText } from '../lib/prosemirror-text.js';
import { dropArtifactIndex, reindexArtifact } from '../lib/search-index.js';

// Rich-text sections: ProseMirror JSON stored directly in the DB (no S3, no
// upload lifecycle). On write, plain text is walked out of the JSON and upserted
// into SearchIndex synchronously.

const createBody = {
  type: 'object',
  properties: { label: { type: ['string', 'null'] } },
} as const;

const patchBody = {
  type: 'object',
  properties: {
    label: { type: ['string', 'null'] },
    contentJson: { type: ['object', 'null'] },
    order: { type: 'number' },
  },
} as const;

const serialize = (row: {
  id: string;
  entryId: string;
  label: string | null;
  order: number;
  contentJson: unknown;
}) => ({
  id: row.id,
  entryId: row.entryId,
  label: row.label,
  order: row.order,
  contentJson: row.contentJson ?? null,
});

export function sectionRoutes(app: FastifyInstance): void {
  app.post<{ Params: { entryId: string }; Body: { label?: string | null } }>(
    '/entries/:entryId/sections',
    { schema: { body: createBody } },
    async (req, reply) => {
      const entry = await app.prisma.entry.findUnique({ where: { id: req.params.entryId } });
      if (!entry) throw notFound('entry', req.params.entryId);
      const last = await app.prisma.section.findFirst({
        where: { entryId: entry.id },
        orderBy: { order: 'desc' },
      });
      const row = await app.prisma.section.create({
        data: {
          entryId: entry.id,
          label: req.body.label ?? null,
          contentJson: undefined,
          order: (last?.order ?? 0) + 1,
        },
      });
      return reply.code(201).send(serialize(row));
    }
  );

  app.get<{ Params: { id: string } }>('/sections/:id', async (req) => {
    const row = await app.prisma.section.findUnique({ where: { id: req.params.id } });
    if (!row) throw notFound('section', req.params.id);
    return serialize(row);
  });

  app.patch<{
    Params: { id: string };
    Body: { label?: string | null; contentJson?: object | null; order?: number };
  }>('/sections/:id', { schema: { body: patchBody } }, async (req) => {
    const existing = await app.prisma.section.findUnique({ where: { id: req.params.id } });
    if (!existing) throw notFound('section', req.params.id);

    const hasContent = req.body.contentJson !== undefined;
    const label = req.body.label !== undefined ? req.body.label : existing.label;
    const row = await app.prisma.section.update({
      where: { id: existing.id },
      data: {
        ...(req.body.label !== undefined ? { label: req.body.label } : {}),
        // Explicit null clears the column (SQL NULL); an object replaces it.
        ...(hasContent
          ? { contentJson: req.body.contentJson === null ? Prisma.DbNull : req.body.contentJson }
          : {}),
        ...(req.body.order !== undefined ? { order: req.body.order } : {}),
      },
    });

    // Full-document replace: re-extract plain text and upsert the index. Label
    // is indexed alongside so a section titled after its subject is findable.
    if (hasContent || req.body.label !== undefined) {
      const source = hasContent ? req.body.contentJson : existing.contentJson;
      const text = source ? extractProseMirrorText(source) : '';
      await reindexArtifact(app.prisma, existing.entryId, 'section', existing.id, [text, label]);
    }
    return serialize(row);
  });

  app.delete<{ Params: { id: string } }>('/sections/:id', async (req, reply) => {
    const row = await app.prisma.section.findUnique({ where: { id: req.params.id } });
    if (!row) throw notFound('section', req.params.id);
    await dropArtifactIndex(app.prisma, row.id);
    await app.prisma.section.delete({ where: { id: row.id } });
    return reply.code(204).send();
  });
}
