import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  makeApp,
  resetDb,
  api,
  createWorld,
  createEntry,
  createRelationType,
} from '../helpers.js';

let app: FastifyInstance;
beforeAll(async () => {
  app = await makeApp();
});
afterAll(async () => {
  await app.close();
});
beforeEach(resetDb);

async function setup() {
  const w = await createWorld(app);
  const a = await createEntry(app, w.id, { title: 'Village' });
  const b = await createEntry(app, w.id, { title: 'Province' });
  const c = await createEntry(app, w.id, { title: 'Kingdom' });
  const locatedIn = await createRelationType(app, w.id, 'located-in', 'contains');
  return { worldId: w.id, a, b, c, locatedIn };
}

describe('POST /relations', () => {
  it('creates a typed edge', async () => {
    const { a, b, locatedIn } = await setup();
    const res = await api(app, 'POST', '/relations', {
      fromId: a.id,
      toId: b.id,
      typeId: locatedIn.id,
    });
    expect(res.status).toBe(201);
    expect(res.body.fromId).toBe(a.id);
    expect(res.body.toId).toBe(b.id);
    expect(res.body.typeId).toBe(locatedIn.id);
  });

  it('409s on an exact duplicate', async () => {
    const { a, b, locatedIn } = await setup();
    const body = { fromId: a.id, toId: b.id, typeId: locatedIn.id };
    await api(app, 'POST', '/relations', body);
    const res = await api(app, 'POST', '/relations', body);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
  });

  it('rejects self-loops', async () => {
    const { a, locatedIn } = await setup();
    const res = await api(app, 'POST', '/relations', {
      fromId: a.id,
      toId: a.id,
      typeId: locatedIn.id,
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION');
  });

  it('rejects entries from different worlds with CROSS_WORLD', async () => {
    const { a, locatedIn } = await setup();
    const otherWorld = await createWorld(app, 'Elsewhere');
    const foreign = await createEntry(app, otherWorld.id);
    const res = await api(app, 'POST', '/relations', {
      fromId: a.id,
      toId: foreign.id,
      typeId: locatedIn.id,
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('CROSS_WORLD');
  });

  it('rejects a relation type from a different world with CROSS_WORLD', async () => {
    const { a, b } = await setup();
    const otherWorld = await createWorld(app, 'Elsewhere');
    const foreignType = await createRelationType(app, otherWorld.id, 'causes', null);
    const res = await api(app, 'POST', '/relations', {
      fromId: a.id,
      toId: b.id,
      typeId: foreignType.id,
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('CROSS_WORLD');
  });

  it('404s on unknown entry or type', async () => {
    const { a, b, locatedIn } = await setup();
    const missing = '00000000-0000-0000-0000-000000000000';
    expect(
      (await api(app, 'POST', '/relations', { fromId: a.id, toId: missing, typeId: locatedIn.id }))
        .status
    ).toBe(404);
    expect(
      (await api(app, 'POST', '/relations', { fromId: a.id, toId: b.id, typeId: missing })).status
    ).toBe(404);
  });
});

describe('GET /entries/:entryId/relations', () => {
  it('lists edges with type info and the other entry, honoring direction', async () => {
    const { a, b, locatedIn } = await setup();
    await api(app, 'POST', '/relations', { fromId: a.id, toId: b.id, typeId: locatedIn.id });

    const out = await api(app, 'GET', `/entries/${a.id}/relations?direction=out`);
    expect(out.status).toBe(200);
    expect(out.body.items).toHaveLength(1);
    const edge = out.body.items[0];
    expect(edge.type).toEqual({
      id: locatedIn.id,
      name: 'located-in',
      inverseName: 'contains',
    });
    expect(edge.otherEntry).toEqual({ id: b.id, title: 'Province', type: 'place' });

    const inbound = await api(app, 'GET', `/entries/${a.id}/relations?direction=in`);
    expect(inbound.body.items).toEqual([]);

    const inboundB = await api(app, 'GET', `/entries/${b.id}/relations?direction=in`);
    expect(inboundB.body.items).toHaveLength(1);
    expect(inboundB.body.items[0].otherEntry.id).toBe(a.id);
  });

  it('filters by typeId', async () => {
    const { worldId, a, b, locatedIn } = await setup();
    const causes = await createRelationType(app, worldId, 'causes', null);
    await api(app, 'POST', '/relations', { fromId: a.id, toId: b.id, typeId: locatedIn.id });
    await api(app, 'POST', '/relations', { fromId: a.id, toId: b.id, typeId: causes.id });

    const res = await api(app, 'GET', `/entries/${a.id}/relations?typeId=${causes.id}`);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].type.name).toBe('causes');
  });
});

describe('DELETE /relations/:id', () => {
  it('removes the edge', async () => {
    const { a, b, locatedIn } = await setup();
    const rel = await api(app, 'POST', '/relations', {
      fromId: a.id,
      toId: b.id,
      typeId: locatedIn.id,
    });
    expect((await api(app, 'DELETE', `/relations/${rel.body.id}`)).status).toBe(204);
    const list = await api(app, 'GET', `/entries/${a.id}/relations`);
    expect(list.body.items).toEqual([]);
  });
});

describe('GET /entries/:entryId/graph', () => {
  // Chain: Village --located-in--> Province --located-in--> Kingdom
  async function chainSetup() {
    const ctx = await setup();
    const { a, b, c, locatedIn } = ctx;
    await api(app, 'POST', '/relations', { fromId: a.id, toId: b.id, typeId: locatedIn.id });
    await api(app, 'POST', '/relations', { fromId: b.id, toId: c.id, typeId: locatedIn.id });
    return ctx;
  }

  it('depth bounds the traversal', async () => {
    const { a, b, c } = await chainSetup();

    const d1 = await api(app, 'GET', `/entries/${a.id}/graph?depth=1`);
    expect(d1.status).toBe(200);
    expect(d1.body.nodes.map((n: any) => n.id).sort()).toEqual([a.id, b.id].sort());

    const d2 = await api(app, 'GET', `/entries/${a.id}/graph?depth=2`);
    expect(d2.body.nodes.map((n: any) => n.id).sort()).toEqual([a.id, b.id, c.id].sort());
    const depthOf = Object.fromEntries(d2.body.nodes.map((n: any) => [n.id, n.depth]));
    expect(depthOf[a.id]).toBe(0);
    expect(depthOf[b.id]).toBe(1);
    expect(depthOf[c.id]).toBe(2);
    expect(d2.body.edges).toHaveLength(2);
  });

  it('direction=out follows outgoing edges only', async () => {
    const { a, b, c } = await chainSetup();
    const res = await api(app, 'GET', `/entries/${b.id}/graph?depth=2&direction=out`);
    expect(res.body.nodes.map((n: any) => n.id).sort()).toEqual([b.id, c.id].sort());

    const inbound = await api(app, 'GET', `/entries/${b.id}/graph?depth=2&direction=in`);
    expect(inbound.body.nodes.map((n: any) => n.id).sort()).toEqual([a.id, b.id].sort());
  });

  it('filters edges by typeId', async () => {
    const { worldId, a, b, c, locatedIn } = await chainSetup();
    const causes = await createRelationType(app, worldId, 'causes', null);
    await api(app, 'POST', '/relations', { fromId: a.id, toId: c.id, typeId: causes.id });

    const res = await api(app, 'GET', `/entries/${a.id}/graph?depth=3&typeId=${locatedIn.id}`);
    expect(res.body.edges.every((e: any) => e.typeId === locatedIn.id)).toBe(true);
    expect(res.body.nodes.map((n: any) => n.id).sort()).toEqual([a.id, b.id, c.id].sort());
  });

  it('rejects out-of-range depth', async () => {
    const { a } = await setup();
    const res = await api(app, 'GET', `/entries/${a.id}/graph?depth=9`);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION');
  });
});
