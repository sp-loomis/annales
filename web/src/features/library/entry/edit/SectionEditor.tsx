// One Section block's scoped Tiptap editor. The editor is the live source of
// content; onUpdate (debounced) mirrors JSON + dirty flag into the draft so
// dirtiness checks, guards and Save all read draftStore. A persistent toolbar
// provides formatting controls while editing.

import { useEffect, useMemo, useRef } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import type { Editor } from "@tiptap/core";
import {
  CodeIcon,
  FunctionIcon,
  ListBulletsIcon,
  ListIcon,
  QuotesIcon,
  TextBIcon,
  TextHOneIcon,
  TextHThreeIcon,
  TextHTwoIcon,
  TextItalicIcon,
  TextSubscriptIcon,
  TextSuperscriptIcon,
} from "@phosphor-icons/react";
import type { PMNode } from "../../../../api/types";
import { buildExtensions } from "../tiptap/extensions";
import styles from "./SectionEditor.module.css";

const CONTENT_DEBOUNCE_MS = 300;

function ToolbarButton({
  editor,
  active,
  label,
  onClick,
  children,
}: {
  editor: Editor;
  active: boolean;
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  void editor;
  return (
    <button
      type="button"
      className={[styles.toolButton, active ? styles.toolActive : ""].filter(Boolean).join(" ")}
      aria-label={label}
      title={label}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}>
      {children}
    </button>
  );
}

export function SectionEditor({
  toolbarVisible = false,
  actionBar,
  initialContent,
  onContentChange,
  onEditorReady,
}: {
  toolbarVisible?: boolean;
  actionBar?: React.ReactNode;
  initialContent: PMNode | null;
  onContentChange: (json: PMNode) => void;
  onEditorReady?: (editor: Editor | null) => void;
}) {
  const timer = useRef<number | null>(null);
  const extensions = useMemo(() => buildExtensions("Write…"), []);

  const editor = useEditor({
    extensions,
    content: (initialContent as object | null) ?? "",
    onUpdate: ({ editor }) => {
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = window.setTimeout(() => {
        timer.current = null;
        onContentChange(editor.getJSON() as PMNode);
      }, CONTENT_DEBOUNCE_MS);
    },
  });

  useEffect(() => {
    onEditorReady?.(editor);
    return () => onEditorReady?.(null);
  }, [editor, onEditorReady]);

  // Flush the pending debounce on unmount so no keystrokes are lost.
  useEffect(() => {
    return () => {
      if (timer.current !== null && editor) {
        clearTimeout(timer.current);
        onContentChange(editor.getJSON() as PMNode);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  if (!editor) return null;

  return (
    <div className={styles.wrapper}>
      {(actionBar || toolbarVisible) && (
        <div
          className={[styles.toolbar, toolbarVisible ? styles.toolbarExpanded : ""]
            .filter(Boolean)
            .join(" ")}>
          {actionBar && <div className={styles.actionBar}>{actionBar}</div>}
          {toolbarVisible && (
            <div className={styles.formatBar}>
              <ToolbarButton
                editor={editor}
                active={editor.isActive("bold")}
                label="Bold"
                onClick={() => editor.chain().focus().toggleBold().run()}>
                <TextBIcon size={14} />
              </ToolbarButton>
              <ToolbarButton
                editor={editor}
                active={editor.isActive("italic")}
                label="Italic"
                onClick={() => editor.chain().focus().toggleItalic().run()}>
                <TextItalicIcon size={14} />
              </ToolbarButton>
              <ToolbarButton
                editor={editor}
                active={editor.isActive("code")}
                label="Inline code"
                onClick={() => editor.chain().focus().toggleCode().run()}>
                <CodeIcon size={14} />
              </ToolbarButton>
              <ToolbarButton
                editor={editor}
                active={editor.isActive("math_inline")}
                label="Inline equation (Cmd+Shift+M)"
                onClick={() => editor.chain().focus().insertInlineMath().run()}>
                <FunctionIcon size={14} />
              </ToolbarButton>
              <ToolbarButton
                editor={editor}
                active={editor.isActive("superscript")}
                label="Superscript"
                onClick={() => editor.chain().focus().toggleSuperscript().run()}>
                <TextSuperscriptIcon size={14} />
              </ToolbarButton>
              <ToolbarButton
                editor={editor}
                active={editor.isActive("subscript")}
                label="Subscript"
                onClick={() => editor.chain().focus().toggleSubscript().run()}>
                <TextSubscriptIcon size={14} />
              </ToolbarButton>
              <span className={styles.divider} />
              <ToolbarButton
                editor={editor}
                active={editor.isActive("heading", { level: 2 })}
                label="Heading 2"
                onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>
                <TextHOneIcon size={14} />
              </ToolbarButton>
              <ToolbarButton
                editor={editor}
                active={editor.isActive("heading", { level: 3 })}
                label="Heading 3"
                onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}>
                <TextHTwoIcon size={14} />
              </ToolbarButton>
              <ToolbarButton
                editor={editor}
                active={editor.isActive("heading", { level: 4 })}
                label="Heading 4"
                onClick={() => editor.chain().focus().toggleHeading({ level: 4 }).run()}>
                <TextHThreeIcon size={14} />
              </ToolbarButton>
              <span className={styles.divider} />
              <ToolbarButton
                editor={editor}
                active={editor.isActive("bulletList")}
                label="Bullet list"
                onClick={() => editor.chain().focus().toggleBulletList().run()}>
                <ListBulletsIcon size={14} />
              </ToolbarButton>
              <ToolbarButton
                editor={editor}
                active={editor.isActive("orderedList")}
                label="Ordered list"
                onClick={() => editor.chain().focus().toggleOrderedList().run()}>
                <ListIcon size={14} />
              </ToolbarButton>
              <ToolbarButton
                editor={editor}
                active={editor.isActive("blockquote")}
                label="Blockquote"
                onClick={() => editor.chain().focus().toggleBlockquote().run()}>
                <QuotesIcon size={14} />
              </ToolbarButton>
            </div>
          )}
        </div>
      )}
      <EditorContent editor={editor} className={styles.editor} />
    </div>
  );
}
