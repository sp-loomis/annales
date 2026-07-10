// [[ typeahead: typing "[[" opens a dropdown searching the world's entries by
// title; selecting inserts an entryLink atom (and removes the "[[query" text).
// The dropdown is a vanilla-DOM portal positioned from the plugin's clientRect
// — no popper dependency needed for a caret-anchored list.

import { Extension } from '@tiptap/core';
import Suggestion from '@tiptap/suggestion';
import type { SuggestionProps, SuggestionKeyDownProps } from '@tiptap/suggestion';
import { get, apiFetch } from '../../../../api/client';
import type { Page, EntrySummary, SearchResult } from '../../../../api/types';
import { useWorkspaceStore } from '../../../../stores/workspaceStore';
import './LinkTypeahead.css';

export interface LinkItem {
  entryId: string;
  label: string;
  typeSlug: string;
}

async function fetchItems(query: string): Promise<LinkItem[]> {
  const worldId = useWorkspaceStore.getState().activeWorldId;
  if (!worldId) return [];
  try {
    if (query.trim()) {
      const res = await get<Page<SearchResult>>(
        `/worlds/${worldId}/search?q=${encodeURIComponent(query.trim())}&limit=10`
      );
      return res.items.map((r) => ({ entryId: r.entryId, label: r.title, typeSlug: r.type }));
    }
    const res = await apiFetch<Page<EntrySummary>>(`/worlds/${worldId}/entries?limit=10`);
    return res.items.map((e) => ({ entryId: e.id, label: e.title, typeSlug: e.type }));
  } catch {
    return [];
  }
}

class TypeaheadList {
  private el: HTMLDivElement;
  private items: LinkItem[] = [];
  private selected = 0;
  private command: (item: LinkItem) => void = () => {};

  constructor() {
    this.el = document.createElement('div');
    this.el.className = 'link-typeahead';
    this.el.setAttribute('data-testid', 'link-typeahead');
    document.body.appendChild(this.el);
  }

  update(props: SuggestionProps<LinkItem>) {
    this.items = props.items;
    this.selected = Math.min(this.selected, Math.max(0, this.items.length - 1));
    this.command = (item) => props.command(item);
    const rect = props.clientRect?.();
    if (rect) {
      this.el.style.left = `${rect.left}px`;
      this.el.style.top = `${rect.bottom + 4}px`;
    }
    this.render();
  }

  onKeyDown(props: SuggestionKeyDownProps): boolean {
    if (props.event.key === 'ArrowDown') {
      this.selected = (this.selected + 1) % Math.max(1, this.items.length);
      this.render();
      return true;
    }
    if (props.event.key === 'ArrowUp') {
      this.selected =
        (this.selected - 1 + Math.max(1, this.items.length)) % Math.max(1, this.items.length);
      this.render();
      return true;
    }
    if (props.event.key === 'Enter') {
      const item = this.items[this.selected];
      if (item) this.command(item);
      return true;
    }
    if (props.event.key === 'Escape') {
      this.destroy();
      return true;
    }
    return false;
  }

  private render() {
    this.el.replaceChildren();
    if (this.items.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'link-typeahead__empty';
      empty.textContent = 'No entries found';
      this.el.appendChild(empty);
      return;
    }
    this.items.forEach((item, i) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className =
        'link-typeahead__item' + (i === this.selected ? ' link-typeahead__item--selected' : '');
      btn.setAttribute('data-testid', `link-typeahead-item-${item.entryId}`);
      const title = document.createElement('span');
      title.textContent = item.label;
      const slug = document.createElement('span');
      slug.className = 'link-typeahead__slug';
      slug.textContent = item.typeSlug;
      btn.append(title, slug);
      btn.addEventListener('mousedown', (e) => {
        e.preventDefault();
        this.command(item);
      });
      this.el.appendChild(btn);
    });
  }

  destroy() {
    this.el.remove();
  }
}

export const LinkSuggestion = Extension.create({
  name: 'entryLinkSuggestion',

  addProseMirrorPlugins() {
    return [
      Suggestion<LinkItem>({
        editor: this.editor,
        char: '[[',
        allowSpaces: true,
        items: ({ query }) => fetchItems(query),
        command: ({ editor, range, props }) => {
          editor
            .chain()
            .focus()
            .insertContentAt(range, [
              {
                type: 'entryLink',
                attrs: { entryId: props.entryId, label: props.label, typeSlug: props.typeSlug },
              },
              { type: 'text', text: ' ' },
            ])
            .run();
        },
        render: () => {
          let list: TypeaheadList | null = null;
          return {
            onStart: (props) => {
              list = new TypeaheadList();
              list.update(props);
            },
            onUpdate: (props) => list?.update(props),
            onKeyDown: (props) => list?.onKeyDown(props) ?? false,
            onExit: () => {
              list?.destroy();
              list = null;
            },
          };
        },
      }),
    ];
  },
});
