// Ordered artifact-block list in edit mode. dnd-kit handles reorder; the +
// affordances insert Section/Image/Sketch blocks; sections support split at
// cursor, merge with the next section, and copy-body text. All structural changes
// land in the draft — only image/sketch byte uploads run immediately.

import { useRef, useState } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import type { DragEndEvent } from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { ArrowsInLineVerticalIcon, Copy, SplitVertical, Trash } from "@phosphor-icons/react";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import type { Editor } from "@tiptap/core";
import { createArtifact, finalizeArtifact, uploadToPresigned } from "../../../../api/endpoints";
import type { PMNode } from "../../../../api/types";
import { useDraftStore } from "../../../../stores/draftStore";
import { IconButton } from "../../../../components/IconButton";
import { mergeDocs, splitDocAtCursor } from "../../../../lib/prosemirror";
import { nextBlockKey, type BlockDraft } from "./draft";
import { SectionEditor } from "./SectionEditor";
import { BlockFrame } from "./BlockFrame";
import { InsertPicker } from "./InsertPicker";
import { ImageBlockEdit, type PendingUpload } from "./ImageBlockEdit";
import { SketchBlockEdit } from "./SketchBlockEdit";
import { TID } from "../../../../testids";
import styles from "./BlockCompositor.module.css";

const EMPTY_SCENE = JSON.stringify({
  type: "excalidraw",
  version: 2,
  source: "sheaf",
  elements: [],
  appState: {},
  files: {},
});

function pmNodeToText(node: PMNode | null | undefined): string {
  if (!node) return "";
  if ("text" in node && typeof node.text === "string") return node.text;
  const children = Array.isArray(node.content) ? node.content : [];
  if (children.length === 0) return "";
  const isParagraphLike =
    node.type === "paragraph" || node.type === "heading" || node.type === "blockquote";
  const separator = isParagraphLike ? "\n\n" : "\n";
  return children
    .map((child) => pmNodeToText(child as PMNode))
    .filter(Boolean)
    .join(separator)
    .trim();
}

export function BlockCompositor({ entryId }: { entryId: string }) {
  const draft = useDraftStore((s) => s.drafts[entryId]);
  const updateDraft = useDraftStore((s) => s.updateDraft);
  const editorsRef = useRef(new Map<string, Editor>());
  const [pendingUploads, setPendingUploads] = useState<Record<string, PendingUpload>>({});
  const [autoOpenSketch, setAutoOpenSketch] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  if (!draft) return null;
  const blocks = draft.blocks;

  const setBlocks = (mutate: (blocks: BlockDraft[]) => BlockDraft[]) =>
    updateDraft(entryId, (d) => ({ ...d, blocks: mutate(d.blocks) }));

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setBlocks((bs) => {
      const from = bs.findIndex((b) => b.key === active.id);
      const to = bs.findIndex((b) => b.key === over.id);
      return from === -1 || to === -1 ? bs : arrayMove(bs, from, to);
    });
  };

  const insertAt = (afterKey: string | null, block: BlockDraft) =>
    setBlocks((bs) => {
      if (afterKey === null) return [...bs, block];
      const idx = bs.findIndex((b) => b.key === afterKey);
      const next = [...bs];
      next.splice(idx + 1, 0, block);
      return next;
    });

  const insertSection = (afterKey: string | null) =>
    insertAt(afterKey, {
      kind: "section",
      key: nextBlockKey(),
      contentJson: null,
      contentDirty: false,
    });

  const insertImage = async (afterKey: string | null, file: File) => {
    const created = await createArtifact("images", entryId, { contentType: file.type });
    updateDraft(entryId, (d) => ({
      ...d,
      createdArtifactIds: [...d.createdArtifactIds, { kind: "images", id: created.id }],
    }));
    setPendingUploads((p) => ({
      ...p,
      [created.id]: { file, presignedUrl: created.upload.url },
    }));
    insertAt(afterKey, {
      kind: "image",
      key: created.id,
      imageId: created.id,
      label: null,
      labelDirty: false,
    });
  };

  const insertSketch = async (afterKey: string | null) => {
    const created = await createArtifact("sketches", entryId, {});
    updateDraft(entryId, (d) => ({
      ...d,
      createdArtifactIds: [...d.createdArtifactIds, { kind: "sketches", id: created.id }],
    }));
    // A sketch must hold a valid scene before the drawer can round-trip it.
    await uploadToPresigned(
      created.upload.url,
      new Blob([EMPTY_SCENE], { type: "application/json" }),
      "application/json"
    );
    await finalizeArtifact("sketches", created.id);
    setAutoOpenSketch(created.id);
    insertAt(afterKey, {
      kind: "sketch",
      key: created.id,
      sketchId: created.id,
      label: null,
      labelDirty: false,
    });
  };

  const deleteBlock = (block: BlockDraft) =>
    updateDraft(entryId, (d) => {
      const blocks = d.blocks.filter((b) => b.key !== block.key);
      if (block.kind === "section" && block.sectionId) {
        return { ...d, blocks, deletedSectionIds: [...d.deletedSectionIds, block.sectionId] };
      }
      if (block.kind === "image") {
        return {
          ...d,
          blocks,
          deletedArtifacts: [...d.deletedArtifacts, { kind: "images", id: block.imageId }],
        };
      }
      if (block.kind === "sketch") {
        return {
          ...d,
          blocks,
          deletedArtifacts: [...d.deletedArtifacts, { kind: "sketches", id: block.sketchId }],
        };
      }
      return { ...d, blocks };
    });

  const copySectionText = async (block: BlockDraft & { kind: "section" }) => {
    const editor = editorsRef.current.get(block.key);
    const text = editor
      ? editor.getText({ blockSeparator: "\n\n" }).trim()
      : pmNodeToText(block.contentJson);
    await navigator.clipboard.writeText(text);
  };

  const splitSection = (block: BlockDraft & { kind: "section" }) => {
    const editor = editorsRef.current.get(block.key);
    if (!editor) return;
    const { before, after } = splitDocAtCursor(editor);
    setBlocks((bs) => {
      const idx = bs.findIndex((b) => b.key === block.key);
      if (idx === -1) return bs;
      const next = [...bs];
      // Both halves get fresh keys so the editors remount with the new docs.
      next.splice(
        idx,
        1,
        {
          kind: "section",
          key: nextBlockKey(),
          sectionId: block.sectionId,
          contentJson: before,
          contentDirty: true,
        },
        {
          kind: "section",
          key: nextBlockKey(),
          contentJson: after,
          contentDirty: false,
        }
      );
      return next;
    });
  };

  const mergeWithNext = (
    block: BlockDraft & { kind: "section" },
    nextBlock: BlockDraft & { kind: "section" }
  ) => {
    const editorA = editorsRef.current.get(block.key);
    const editorB = editorsRef.current.get(nextBlock.key);
    const docA = editorA ? (editorA.getJSON() as never) : block.contentJson;
    const docB = editorB ? (editorB.getJSON() as never) : nextBlock.contentJson;
    updateDraft(entryId, (d) => {
      const idx = d.blocks.findIndex((b) => b.key === block.key);
      if (idx === -1 || d.blocks[idx + 1]?.key !== nextBlock.key) return d;
      const blocks = [...d.blocks];
      blocks.splice(idx, 2, {
        kind: "section",
        key: nextBlockKey(),
        sectionId: block.sectionId,
        contentJson: mergeDocs(docA, docB),
        contentDirty: true,
      });
      return {
        ...d,
        blocks,
        deletedSectionIds: nextBlock.sectionId
          ? [...d.deletedSectionIds, nextBlock.sectionId]
          : d.deletedSectionIds,
      };
    });
  };

  return (
    <div className={styles.compositor}>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        modifiers={[restrictToVerticalAxis]}
        onDragEnd={onDragEnd}>
        <SortableContext items={blocks.map((b) => b.key)} strategy={verticalListSortingStrategy}>
          {blocks.map((block, index) => {
            const nextBlock = blocks[index + 1];
            const canMerge = block.kind === "section" && nextBlock?.kind === "section";
            return (
              <div key={block.key}>
                <BlockFrame
                  blockKey={block.key}
                  actions={
                    block.kind === "section" ? undefined : (
                      <>
                        <IconButton
                          label="Delete block"
                          onClick={() => deleteBlock(block)}
                          data-testid={TID.blockDelete(block.key)}>
                          <Trash size={13} />
                        </IconButton>
                      </>
                    )
                  }>
                  {block.kind === "section" && (
                    <div className={styles.sectionBlock}>
                      <SectionEditor
                        actionBar={
                          <>
                            <IconButton
                              label="Split at cursor"
                              onClick={() => splitSection(block)}
                              data-testid={TID.blockSplit(block.key)}>
                              <SplitVertical size={13} />
                            </IconButton>
                            <IconButton
                              label="Copy text body"
                              onClick={() => void copySectionText(block)}
                              data-testid={TID.blockDuplicate(block.key)}>
                              <Copy size={13} />
                            </IconButton>
                            <IconButton
                              label="Delete block"
                              onClick={() => deleteBlock(block)}
                              data-testid={TID.blockDelete(block.key)}>
                              <Trash size={13} />
                            </IconButton>
                          </>
                        }
                        initialContent={block.contentJson}
                        onContentChange={(json) =>
                          updateDraft(entryId, (d) => ({
                            ...d,
                            blocks: d.blocks.map((b) =>
                              b.key === block.key && b.kind === "section"
                                ? { ...b, contentJson: json, contentDirty: true }
                                : b
                            ),
                          }))
                        }
                        onEditorReady={(editor) => {
                          if (editor) editorsRef.current.set(block.key, editor);
                          else editorsRef.current.delete(block.key);
                        }}
                      />
                    </div>
                  )}
                  {block.kind === "image" && (
                    <ImageBlockEdit
                      blockKey={block.key}
                      imageId={block.imageId}
                      label={block.label}
                      pendingUpload={pendingUploads[block.imageId]}
                      onLabelChange={(label) =>
                        updateDraft(entryId, (d) => ({
                          ...d,
                          blocks: d.blocks.map((b) =>
                            b.key === block.key && b.kind === "image"
                              ? { ...b, label, labelDirty: true }
                              : b
                          ),
                        }))
                      }
                    />
                  )}
                  {block.kind === "sketch" && (
                    <SketchBlockEdit
                      blockKey={block.key}
                      sketchId={block.sketchId}
                      label={block.label}
                      autoOpen={autoOpenSketch === block.sketchId}
                      onLabelChange={(label) =>
                        updateDraft(entryId, (d) => ({
                          ...d,
                          blocks: d.blocks.map((b) =>
                            b.key === block.key && b.kind === "sketch"
                              ? { ...b, label, labelDirty: true }
                              : b
                          ),
                        }))
                      }
                    />
                  )}
                </BlockFrame>
                <div className={styles.interstitial}>
                  <div className={styles.interstitialLine} aria-hidden="true" />
                  <div
                    className={[
                      styles.interstitialControls,
                      canMerge ? styles.interstitialControlsWithMerge : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}>
                    <InsertPicker
                      afterKey={block.key}
                      onSection={() => insertSection(block.key)}
                      onImage={(file) => void insertImage(block.key, file)}
                      onSketch={() => void insertSketch(block.key)}
                    />
                    {canMerge && (
                      <button
                        type="button"
                        className={styles.mergeButton}
                        onClick={() =>
                          mergeWithNext(
                            block as BlockDraft & { kind: "section" },
                            nextBlock as BlockDraft & { kind: "section" }
                          )
                        }
                        data-testid={TID.blockMerge(block.key)}>
                        <ArrowsInLineVerticalIcon size={12} />
                        Merge Sections
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </SortableContext>
      </DndContext>
      {blocks.length === 0 && (
        <>
          <p className={styles.emptyHint}>Add a section to begin — the + below is the way in.</p>
          <div className={styles.interstitial}>
            <div className={styles.interstitialLine} aria-hidden="true" />
            <div className={styles.interstitialControls}>
              <InsertPicker
                afterKey="end"
                onSection={() => insertSection(null)}
                onImage={(file) => void insertImage(null, file)}
                onSketch={() => void insertSketch(null)}
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
