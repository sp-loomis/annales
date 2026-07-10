# Sheaf frontend

React SPA for the worldbuilding platform. UI/UX spec: `../docs/sketch/frontend-spec.md`.
Day-to-day run instructions: `../docs/GUIDE.md` → "Frontend dev mode".

```sh
npm run dev:web          # from the repo root (Vite on :5173, proxies /api → :3000)
npm run typecheck -w web
npm run build -w web     # static bundle in web/dist/
```

## Stack

| Concern | Choice |
|---|---|
| Build | Vite + React 18 + TypeScript (React pinned to 18 — Excalidraw's peer range; see gotchas) |
| Components | Radix Primitives (`radix-ui` unified package, unstyled) |
| Styling | Vanilla CSS + CSS Modules; theming via custom properties |
| Server state | TanStack Query (`src/api/keys.ts` is the query-key factory) |
| Client state | zustand — `workspaceStore` (world/tabs/sidebar), `draftStore` (edit buffers) |
| Rich text | Tiptap v2, prose-only config + custom `entryLink` atom + `[[` typeahead |
| Sketches | Excalidraw (dynamic import only — separate chunk) |
| Reorder | dnd-kit |
| Icons | `@phosphor-icons/react`; full set isolated in the lazy `icon-map` chunk |
| Panels | react-resizable-panels (collapsible sidebar) |

## Layout of `src/`

```
api/        fetch wrapper (ApiError from the { error } envelope), hand-modeled
            DTOs, query keys, typed endpoint functions
stores/     workspaceStore (active world, per-world tabs + sidebar prefs,
            autosaved to /workspace-state), draftStore (per-entry edit drafts)
theme/      tokens.css (custom-property contract), fonts.ts / palettes.ts,
            ThemeProvider (applies WorldTheme to document root)
components/ styled Radix wrappers (Button, Dialog, ConfirmDialog, …) and
            icons/ (WorldIcon renders Phosphor icons by name via lazy map)
features/
  shell/     header, world switcher, mode rail, resizable AppLayout
  library/   sidebar (search/filter/densities), tabs (TabBar + persistence),
             entry/ (read/ renderers, edit/ compositor + save), relations/
  settings/  World Settings dialog panels + IconPicker
lib/        debounce, ProseMirror split/merge helpers
testids.ts  central data-testid registry — every interactive control uses it
```

## Architecture notes

- **Entry data flow** — `GET /entries/:id` returns sections, images, sketches
  and relations inline; read mode renders straight from the Query cache. Edit
  mode snapshots that into a draft (`draftStore`); Tiptap editors write into
  the draft (debounced), so dirtiness checks, close guards, `beforeunload`
  and Save all read one place. Drafts survive tab switches and unmounts.
- **Save orchestration** (`entry/edit/useSaveEntry.ts`) — one Save button fans
  out: entry PATCH + tags PUT → create new sections → PATCH dirty
  content/labels → reassign `order` → DELETEs. Successes fold back into the
  draft, so a partial failure leaves a residual draft that re-saves only what
  failed.
- **Two persistence tiers** — title/type/tags/sections/order/deletes are
  Save-deferred; image/sketch byte uploads and relations apply immediately.
  Cancel compensates by deleting artifacts created during the session.
- **Theming** — `WorldTheme` (font key, accent/surface hex, dark mode, icon
  weight) → ThemeProvider sets `--world-font`, `--accent`, `--surface-base`;
  everything else derives in `tokens.css` via `color-mix`. Theme edits apply
  optimistically and PUT debounced — no save button.
- **Search** — the backend indexes section/artifact text but NOT titles, and
  its `type` param is single-valued. The sidebar therefore merges client-side
  title-substring matches ahead of server FTS hits, and applies type
  multi-select client-side (`sidebar/useSidebarData.ts`).
- **Lazy chunks** — the full Phosphor icon map and Excalidraw never load until
  first use. Don't import `components/icons/icon-map.ts` or
  `@excalidraw/excalidraw` statically.

## Gotchas

- **React stays on 18** until Excalidraw's peer range allows 19. With mixed
  versions, npm hoists a second React at the repo root → "Invalid hook call"
  at runtime. `vite.config.ts` sets `resolve.dedupe` as a second line of
  defence.
- **zustand v5 selectors must return snapshot-stable references** — returning
  a freshly built object each read loops with "getSnapshot should be cached".
  `workspaceStore` keeps a frozen `EMPTY_WORKSPACE` fallback for this reason.
- **Radix `asChild` needs `forwardRef`** on any custom component used as a
  trigger (Button/IconButton already do this).
- `vite.config.ts` is excluded from `tsconfig.json` — the root workspace's
  vitest pulls a different Vite major and the two type trees clash.

## Verification

With API + web dev servers running:

```sh
node ../scripts/frontend-smoke.mjs   # boots, renders, zero console errors
node ../scripts/frontend-e2e.mjs     # search → edit → save → API persistence
```

Future Playwright tests should select via `data-testid` from `src/testids.ts`.
