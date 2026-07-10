// Save orchestration. The single Save button fans out to the per-resource API:
//   a. entry PATCH (title/type) + tags PUT
//   b. POST new sections (capture ids)
//   c. PATCH dirty section content + artifact labels
//   d. reassign block order (only when the sequence changed or blocks were added)
//   e. DELETE removed sections/artifacts
// Ops run allSettled per phase; each success is folded back into the draft so
// a partial failure leaves a residual, re-saveable draft. Full success drops
// the draft and invalidates the entry + sidebar queries.

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { keys } from "../../../../api/keys";
import {
  createSection,
  deleteArtifact,
  deleteSection,
  patchArtifact,
  patchEntry,
  patchSection,
  putEntryTags,
} from "../../../../api/endpoints";
import { useDraftStore } from "../../../../stores/draftStore";
import { isDraftDirty, orderSignature, type EntryDraft } from "./draft";

interface SaveResult {
  ok: boolean;
  errors: string[];
}

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

async function runSave(draft: EntryDraft): Promise<{ residual: EntryDraft; errors: string[] }> {
  const errors: string[] = [];
  // Work on a deep-enough copy; blocks are replaced immutably as ops succeed.
  let d: EntryDraft = { ...draft, blocks: [...draft.blocks], baseline: { ...draft.baseline } };

  // ---- phase a: entry header ----
  const headerOps: Promise<void>[] = [];
  if (d.title !== d.baseline.title || d.typeSlug !== d.baseline.typeSlug) {
    headerOps.push(
      patchEntry(d.entryId, {
        ...(d.title !== d.baseline.title ? { title: d.title } : {}),
        ...(d.typeSlug !== d.baseline.typeSlug ? { type: d.typeSlug } : {}),
      }).then(() => {
        d = { ...d, baseline: { ...d.baseline, title: d.title, typeSlug: d.typeSlug } };
      })
    );
  }
  if (JSON.stringify(d.tags) !== JSON.stringify(d.baseline.tags)) {
    headerOps.push(
      putEntryTags(d.entryId, d.tags).then(() => {
        d = { ...d, baseline: { ...d.baseline, tags: [...d.tags] } };
      })
    );
  }
  for (const r of await Promise.allSettled(headerOps)) {
    if (r.status === "rejected") errors.push(msg(r.reason));
  }

  // ---- phase b: create new sections (sequential, in block order) ----
  const hadNewSections = d.blocks.some((b) => b.kind === "section" && b.sectionId === undefined);
  for (const block of d.blocks) {
    if (block.kind !== "section" || block.sectionId !== undefined) continue;
    try {
      const created = await createSection(d.entryId);
      d = {
        ...d,
        blocks: d.blocks.map((b) =>
          b.key === block.key && b.kind === "section"
            ? { ...b, sectionId: created.id, contentDirty: b.contentJson !== null }
            : b
        ),
      };
    } catch (e) {
      errors.push(`create section: ${msg(e)}`);
    }
  }

  // ---- phase c: section content + artifact labels ----
  const contentOps: Promise<void>[] = [];
  for (const block of d.blocks) {
    if (block.kind === "section") {
      if (!block.contentDirty) continue;
      if (block.sectionId === undefined) continue; // creation failed above
      const { sectionId, key } = block;
      contentOps.push(
        patchSection(sectionId, {
          ...(block.contentDirty && block.contentJson ? { contentJson: block.contentJson } : {}),
        }).then(() => {
          d = {
            ...d,
            blocks: d.blocks.map((b) =>
              b.key === key && b.kind === "section" ? { ...b, contentDirty: false } : b
            ),
          };
        })
      );
    } else if (block.labelDirty) {
      const kind = block.kind === "image" ? ("images" as const) : ("sketches" as const);
      const id = block.kind === "image" ? block.imageId : block.sketchId;
      const { key } = block;
      contentOps.push(
        patchArtifact(kind, id, { label: block.label }).then(() => {
          d = {
            ...d,
            blocks: d.blocks.map((b) =>
              b.key === key && b.kind !== "section" ? { ...b, labelDirty: false } : b
            ),
          };
        })
      );
    }
  }
  for (const r of await Promise.allSettled(contentOps)) {
    if (r.status === "rejected") errors.push(msg(r.reason));
  }

  // ---- phase d: order ----
  const orderChanged = orderSignature(d.blocks) !== d.baseline.orderSignature;
  if (orderChanged || hadNewSections) {
    const orderOps = d.blocks.map((block, index) => {
      const order = index + 1;
      if (block.kind === "section") {
        if (block.sectionId === undefined) return Promise.resolve();
        return patchSection(block.sectionId, { order }).then(() => undefined);
      }
      const kind = block.kind === "image" ? ("images" as const) : ("sketches" as const);
      const id = block.kind === "image" ? block.imageId : block.sketchId;
      return patchArtifact(kind, id, { order }).then(() => undefined);
    });
    const results = await Promise.allSettled(orderOps);
    const failed = results.filter((r) => r.status === "rejected");
    for (const r of failed) errors.push(msg((r as PromiseRejectedResult).reason));
    if (failed.length === 0) {
      d = { ...d, baseline: { ...d.baseline, orderSignature: orderSignature(d.blocks) } };
    }
  }

  // ---- phase e: deletions ----
  const deleteOps: Promise<void>[] = [];
  for (const sectionId of d.deletedSectionIds) {
    deleteOps.push(
      deleteSection(sectionId).then(() => {
        d = { ...d, deletedSectionIds: d.deletedSectionIds.filter((id) => id !== sectionId) };
      })
    );
  }
  for (const ref of d.deletedArtifacts) {
    deleteOps.push(
      deleteArtifact(ref.kind, ref.id).then(() => {
        d = { ...d, deletedArtifacts: d.deletedArtifacts.filter((a) => a.id !== ref.id) };
      })
    );
  }
  for (const r of await Promise.allSettled(deleteOps)) {
    if (r.status === "rejected") errors.push(msg(r.reason));
  }

  // Saved artifacts are now owned by the entry; cancel-compensation list resets.
  if (errors.length === 0) d = { ...d, createdArtifactIds: [] };

  return { residual: d, errors };
}

export function useSaveEntry(entryId: string, worldId: string | null, onSaved: () => void) {
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  const save = async (): Promise<SaveResult> => {
    const draft = useDraftStore.getState().drafts[entryId];
    if (!draft) return { ok: true, errors: [] };
    setSaving(true);
    setErrors([]);
    try {
      const { residual, errors } = await runSave(draft);
      await queryClient.invalidateQueries({ queryKey: keys.entry(entryId) });
      if (worldId) {
        await queryClient.invalidateQueries({ queryKey: keys.entries(worldId) });
        await queryClient.invalidateQueries({ queryKey: ["worlds", worldId, "search"] });
      }
      if (errors.length === 0 && !isDraftDirty(residual)) {
        useDraftStore.getState().dropDraft(entryId);
        onSaved();
        return { ok: true, errors: [] };
      }
      // Partial failure: keep the residual draft so a re-save retries only
      // what failed.
      useDraftStore.getState().updateDraft(entryId, () => residual);
      setErrors(errors);
      return { ok: false, errors };
    } finally {
      setSaving(false);
    }
  };

  return { save, saving, errors };
}

export function cancelDraft(entryId: string) {
  const draft = useDraftStore.getState().drafts[entryId];
  if (draft) {
    // Compensate eagerly-created artifacts (uploads are immediate; the draft
    // was cancelled, so they must not survive).
    for (const ref of draft.createdArtifactIds) {
      deleteArtifact(ref.kind, ref.id).catch(() => {});
    }
  }
  useDraftStore.getState().dropDraft(entryId);
}
