// Edit-mode draft model. A draft is snapshotted from the loaded EntryDetail
// when edit mode starts; Tiptap editors and header fields write into it, and
// Save (useSaveEntry) diffs it against `baseline`.
//
// Two persistence tiers (deliberate asymmetry):
//  - Save-deferred: title/type/tags, section content/create/delete,
//    block order, artifact deletes.
//  - Immediately persisted: image/sketch uploads (progress UX needs live
//    requests) and relations. Cancel compensates by deleting createdArtifactIds.

import type { EntryDetail, PMNode } from "../../../../api/types";
import type { UploadKind } from "../../../../api/endpoints";

export type BlockDraft =
  | {
      kind: "section";
      key: string;
      /** undefined = created in this draft, not yet on the server */
      sectionId?: string;
      contentJson: PMNode | null;
      contentDirty: boolean;
    }
  | { kind: "image"; key: string; imageId: string; label: string | null; labelDirty: boolean }
  | { kind: "sketch"; key: string; sketchId: string; label: string | null; labelDirty: boolean };

export interface ArtifactRef {
  kind: UploadKind;
  id: string;
}

export interface EntryDraft {
  entryId: string;
  title: string;
  typeSlug: string;
  tags: string[];
  blocks: BlockDraft[];
  deletedSectionIds: string[];
  deletedArtifacts: ArtifactRef[];
  /** Artifacts created during this edit session — deleted on Cancel. */
  createdArtifactIds: ArtifactRef[];
  baseline: {
    title: string;
    typeSlug: string;
    tags: string[];
    /** Block key sequence at snapshot time; order dirtiness = sequence changed. */
    orderSignature: string;
  };
}

let newBlockCounter = 0;
export const nextBlockKey = () => `new-${++newBlockCounter}`;

export function orderSignature(blocks: BlockDraft[]): string {
  return blocks.map((b) => b.key).join("|");
}

export function draftFromDetail(detail: EntryDetail): EntryDraft {
  const blocks: BlockDraft[] = [
    ...detail.sections.map<BlockDraft>((s) => ({
      kind: "section",
      key: s.id,
      sectionId: s.id,
      contentJson: s.contentJson,
      contentDirty: false,
    })),
    ...detail.images.map<BlockDraft>((i) => ({
      kind: "image",
      key: i.id,
      imageId: i.id,
      label: i.label,
      labelDirty: false,
    })),
    ...detail.sketches.map<BlockDraft>((s) => ({
      kind: "sketch",
      key: s.id,
      sketchId: s.id,
      label: s.label,
      labelDirty: false,
    })),
  ];
  // Interleave by stored order across the three artifact arrays.
  const orderOf = new Map<string, number>();
  for (const s of detail.sections) orderOf.set(s.id, s.order);
  for (const i of detail.images) orderOf.set(i.id, i.order);
  for (const s of detail.sketches) orderOf.set(s.id, s.order);
  blocks.sort((a, b) => (orderOf.get(a.key) ?? 0) - (orderOf.get(b.key) ?? 0));

  return {
    entryId: detail.id,
    title: detail.title,
    typeSlug: detail.type,
    tags: [...detail.tags],
    blocks,
    deletedSectionIds: [],
    deletedArtifacts: [],
    createdArtifactIds: [],
    baseline: {
      title: detail.title,
      typeSlug: detail.type,
      tags: [...detail.tags],
      orderSignature: orderSignature(blocks),
    },
  };
}

export function makeUntitledDraft(entryId: string, typeSlug: string): EntryDraft {
  return {
    entryId,
    title: "",
    typeSlug,
    tags: [],
    blocks: [],
    deletedSectionIds: [],
    deletedArtifacts: [],
    createdArtifactIds: [],
    baseline: {
      title: "",
      typeSlug,
      tags: [],
      orderSignature: "",
    },
  };
}

export function isDraftDirty(d: EntryDraft): boolean {
  if (d.title !== d.baseline.title) return true;
  if (d.typeSlug !== d.baseline.typeSlug) return true;
  if (JSON.stringify(d.tags) !== JSON.stringify(d.baseline.tags)) return true;
  if (d.deletedSectionIds.length > 0 || d.deletedArtifacts.length > 0) return true;
  if (orderSignature(d.blocks) !== d.baseline.orderSignature) return true;
  return d.blocks.some((b) =>
    b.kind === "section" ? b.contentDirty || b.sectionId === undefined : b.labelDirty
  );
}
