// Prose-only Tiptap configuration: paragraphs, headings H2–H4, bold, italic,
// inline code, lists, blockquotes. Everything else in StarterKit that isn't
// prose (code blocks, rules, strike) is disabled; image/file/embed extensions
// are simply never installed.

import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import { EntryLinkNode } from './EntryLinkNode';
import { LinkSuggestion } from './LinkSuggestion';

export function buildExtensions(placeholder: string) {
  return [
    StarterKit.configure({
      heading: { levels: [2, 3, 4] },
      codeBlock: false,
      horizontalRule: false,
      strike: false,
    }),
    Placeholder.configure({ placeholder }),
    EntryLinkNode,
    LinkSuggestion,
  ];
}
