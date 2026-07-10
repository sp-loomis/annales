import type { PrismaClient } from '@prisma/client';

export type Direction = 'out' | 'in' | 'both';

// Directional relation view shared by GET /entries/:id (inline, both directions)
// and GET /entries/:id/relations (filterable). `direction` is relative to the
// anchor entry: 'out' when it is fromId, 'in' when it is toId. Type and
// otherEntry carry resolved icons so a client renders without secondary lookups.
export async function relationsView(
  prisma: PrismaClient,
  entryId: string,
  opts: { direction?: Direction; typeId?: string } = {}
) {
  const direction = opts.direction ?? 'both';
  const directionWhere =
    direction === 'out'
      ? { fromId: entryId }
      : direction === 'in'
        ? { toId: entryId }
        : { OR: [{ fromId: entryId }, { toId: entryId }] };

  const rows = await prisma.relation.findMany({
    where: { ...directionWhere, ...(opts.typeId ? { typeId: opts.typeId } : {}) },
    include: {
      from: { include: { type: true } },
      to: { include: { type: true } },
      type: true,
    },
    orderBy: { id: 'asc' },
  });

  return rows.map((r) => {
    const other = r.fromId === entryId ? r.to : r.from;
    return {
      id: r.id,
      direction: (r.fromId === entryId ? 'out' : 'in') as 'out' | 'in',
      fromId: r.fromId,
      toId: r.toId,
      type: {
        id: r.type.id,
        name: r.type.name,
        inverseName: r.type.inverseName,
        iconName: r.type.iconName,
        iconWeight: r.type.iconWeight,
      },
      otherEntry: {
        id: other.id,
        title: other.title,
        type: other.type.slug,
        iconName: other.type.iconName,
        iconWeight: other.type.iconWeight,
      },
    };
  });
}
