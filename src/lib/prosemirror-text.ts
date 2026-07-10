// Walk a ProseMirror JSON document collecting the `text` of every text node,
// depth-first. Block boundaries are joined with newlines so ts_headline builds
// sensible snippets. Tolerant of arbitrary/unknown node shapes — anything that
// isn't a recognisable node/text is skipped.
export function extractProseMirrorText(doc: unknown): string {
  const parts: string[] = [];

  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    const n = node as { type?: unknown; text?: unknown; content?: unknown };
    if (typeof n.text === 'string') parts.push(n.text);
    if (Array.isArray(n.content)) {
      for (const child of n.content) walk(child);
      // Separate block-level content so words don't run together.
      parts.push('\n');
    }
  };

  walk(doc);
  return parts.join('').replace(/\n+/g, '\n').trim();
}
