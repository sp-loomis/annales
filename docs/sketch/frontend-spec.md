# Worldbuilding App — UI/UX Specification

## Overview

A single-user worldbuilding workspace. The application organises content around **Worlds**, each containing typed **Entries** with attached artifacts (rich text sections, images, sketches) and directed **Relations** between entries. The interface prioritises immersive, lore-appropriate aesthetics while progressively disclosing complexity — casual users encounter a clean wiki-like editor; power users can reach configuration and graph search without the tool ever feeling like a dev environment.

> **Backend prerequisites** — before frontend work begins, a set of schema migrations and new/changed API endpoints are required. See `frontend-prereq.md`.

> **Planned add-ons** — Calendars/date ranges and Geometries/maps are designed for but out of scope
> for the initial build. The architecture leaves
> room for both without being built around them.

---

## Scope — Initial Build

The initial build covers:

- **Worlds** — create, theme, switch between
- **Entry types** — per-world vocabulary with icons
- **Relation types** — per-world directed edge vocabulary with icons
- **Entries** — titled, typed, tagged; opened in tabs
- **Block compositor** — ordered sequence of Section, Image, and Sketch blocks
- **Relations** — directed named edges between entries, rendered as a fixed block at the bottom of each entry
- **Library mode** — sidebar search/browse + tabbed body
- **World Settings** — theme, entry types, relation types, worlds

**Explicitly deferred:**

- Geometry blocks and Leaflet map editing → `addon-geometry.md`
- Date ranges and calendar configuration → `addon-calendars.md`
- Maps mode
- Search Layer 3 (date filtering, geographic filtering)
- Graph/relation search

The block compositor, search interface, and configuration panel are designed so these additions slot in without restructuring the existing UI.

---

## Layout Shell

Four persistent regions:

```
┌─────────────────────────────────────────────────────┐
│                    Header                           │
├──────┬──────────────────┬──────────────────────────┤
│      │                  │                          │
│ Mode │   Main Sidebar   │         Body             │
│ Rail │                  │                          │
│      │                  │                          │
└──────┴──────────────────┴──────────────────────────┘
```

### Header

Thin bar spanning full width. Contains:

- **App logo/name** (left)
- **World selector** (centre-left) — displays current world name in its assigned font/accent colour; clicking opens a world switcher popover showing all worlds as chips with their accent colour and EntryType icon cluster as visual fingerprint
- **World Settings button** (right) — opens the Configuration popup

The header never scrolls away and always reflects the active world context.

### Mode Rail

Narrow icon-only sidebar (far left). Each icon selects a workspace mode. Tooltip on hover shows mode name.

| Icon         | Mode    | Status  |
| ------------ | ------- | ------- |
| `BookOpen`   | Library | Active  |
| `MapTrifold` | Maps    | Planned |

Additional modes (Languages, Story, etc.) added here as the application grows. The rail is intentionally sparse — it is navigation infrastructure, not a feature showcase.

### Main Sidebar — Library Mode

Contains the search interface and result list. Fixed width, independently scrollable.

**Density toggle** — a compact row of three icon buttons at the top of the result list (`List`, `SquaresFour`, `Article` or similar) persisted per world in workspace state.

#### Search Bar — Unfolding Complexity

Layers reveal progressively; each layer persists its state across sessions.

**Layer 1 — always visible**
Plain text input. Searches entry titles and section content via full-text index. Returns results immediately on input (debounced).

**Layer 2 — one click to expand**
Revealed by a `Funnel` icon button adjacent to the text input. Shows:

- Entry type selector (multi-select chips using the world's EntryType icons and names)
- Tag filter (chips drawn from tags in use in the current world; AND semantics)
- Sort control: `Updated`, `Title A–Z`, `Title Z–A`
- Group by control: `None`, `Type`, `First letter`

**Layer 3 — reserved for add-ons**
Layer 3 expansion points are defined but not built in the initial release:

- "Filter by date" — reserved for the Calendars add-on
- "Filter by location" — reserved for the Geometry add-on
- Graph/relation search — reserved for a future release

These options are absent from the UI in the initial build rather than shown as disabled, to avoid implying missing functionality.

#### Search Results

Results list below the search bar. Header row shows result count and the density toggle.

**Compact density** — `[TypeIcon] Entry Title` only. One line per result. Maximum scanability.

**Comfortable density** (default) — Icon + title + up to 3 tag chips. Two lines max.

**Detailed density** — text search active: shows matched snippet(s) with `<b>`-highlighted terms below the title. Otherwise identical to comfortable.

Relation information is not shown in flat search results. Clicking a result opens the entry in the Body as a new tab. Tags in result cards are not interactive in v1 (no click-to-filter).

---

## Body — Library Mode

The body is a **tabbed entry workspace**.

### Tab Bar

Sits at the top of the body region. Each tab shows `[TypeIcon] Entry Title`. Tabs are closeable. On overflow (many open tabs), a `CaretDown` overflow menu lists all open tabs by title.

Tab state (open entries, order) is persisted per world in workspace state and restored on world switch.

**Unsaved changes — closing a tab:** if the entry is in edit mode with unsaved changes, closing the tab shows a confirmation dialog ("Discard unsaved changes to [Entry Title]?" with Discard and Keep Editing buttons) before closing.

**Unsaved changes — closing the browser tab or window:** if any entry is in edit mode with unsaved changes, a `beforeunload` handler fires the browser's native "Leave site?" prompt. No custom message is shown (browsers do not allow custom text in `beforeunload` dialogs). The `beforeunload` handler must be registered and deregistered reactively — it should be active only while unsaved changes exist, and must be removed immediately on save or cancel.

### Entry View

Each open entry renders in its tab in one of two modes: **Read** and **Edit**.

The entry is loaded in a single request (`GET /entries/:entryId`) which returns all artifacts and relations inline — no secondary fetches needed to render the full entry view. See backend prerequisites for the updated entry detail response shape.

#### Read Mode (default)

The entry opens in read mode. Content is rendered as a composed, published view — section prose rendered as HTML, images displayed, sketch blocks shown as static previews, relation block rendered as marginalia cards. No editing controls are visible. Inline cross-entry links are clickable. This is the primary reading experience and the mode the entry returns to after saving.

An **Edit** button in the entry header enters edit mode.

#### Edit Mode

Activated by the Edit button. A **Save** and **Cancel** button replace the Edit button in the entry header. Cancel discards unsaved changes and returns to read mode. Save persists all changes and returns to read mode. No autosave.

In edit mode, two regions are active:

**Entry header (editable)** — entry title becomes an editable text field, entry type badge opens a type selector, tag list becomes editable chips, and a `...` menu offers entry-level actions (delete).

**Block compositor** — an ordered list of artifact blocks managed by dnd-kit. Each block shows a drag handle (desktop) or Move up / Move down buttons (mobile) and a hover-revealed action row (`Delete`, `Duplicate`; for Section blocks, also `Split here`).

#### Block Types — Read Mode Rendering

**Section block** — prose rendered as HTML. Inline cross-entry link nodes rendered as styled chips with TypeIcon; clicking opens the target entry in a new tab.

**Image block** — image displayed with caption below.

**Sketch block** — static preview of the Excalidraw scene at reduced scale.

**Geometry block** _(add-on, not built initially)_ — non-interactive minimap thumbnail. Slot is reserved in the compositor; see `addon-geometry.md`.

**Relation block** — fixed block at the bottom of every entry (not stored as a data row). Renders all of the entry's relations as marginalia-style cards: `[RelationTypeIcon] relation name → [TargetTypeIcon] Target Entry Title`. Clicking a target opens it in a new tab. Relation data is included in the entry detail response and requires no secondary fetch.

#### Block Types — Edit Mode Behaviour

**Section block** — activates a scoped Tiptap rich text editor instance. Tiptap is configured prose-only: paragraphs, headings (H2–H4), bold, italic, inline code, bullet lists, ordered lists, blockquotes. Image, file, and embed extensions are explicitly disabled. A floating toolbar appears on text selection only. Inline cross-entry links triggered by typing `[[` — opens a typeahead dropdown searching the world's entries by title. Adjacent Section blocks can be merged via a merge button that appears between them. A focused Section block exposes a "Split at cursor" action that creates two Section blocks from one.

**Image block** — shows an Edit button that opens a replace-image flow (re-upload via presigned URL). Upload progress and pending/failed states shown with retry affordance.

**Sketch block** — shows an "Open sketch" button that expands into a drawer or full-screen overlay containing the live Excalidraw editor. Saving closes the overlay and re-finalizes the artifact.

**Geometry block** _(add-on, not built initially)_ — slot reserved; see `addon-geometry.md`.

**Relation block** — rendered identically in edit mode. Relations are managed via a separate add/remove action rather than inline in the block compositor.

#### Block Insertion

Only available in edit mode. A `+` button appears below each block and at the bottom of the artifact list (above the fixed relation block). Clicking reveals a block type picker. Initial build offers: Section, Image, Sketch. Geometry is added to the picker when the geometry add-on is built. Keyboard shortcut (e.g. `/`) in a focused Section block also triggers the picker.

---

## Configuration — World Settings Popup

Opened from the header. A modal or slide-over panel with a sectioned nav. Initial build includes: Worlds, Entry Types, Relation Types, World Theme. Timelines & Calendars and Globes & CRS sections are added when their respective add-ons are built.

### Worlds

Create, rename, delete worlds. Delete is guarded with a confirmation showing cascade scope.

### Entry Types

Per-world list of entry types. Each row: TypeIcon (from Phosphor picker) + name + slug. Add, rename, reassign icon, delete (guarded: IN_USE if entries exist).

**Icon picker** — searchable grid of Phosphor icons. A "Suggested" section at top shows ~40 icons curated for worldbuilding concepts (people, places, factions, events, creatures, objects, etc.). Full search below. Icon weight selector (thin / light / regular / bold / fill / duotone) with world default applied unless overridden.

**Default types seeded on world creation:** Character, Location, Faction, Event, Object. All deletable if unused.

### Relation Types

Per-world list. Each row: RelationTypeIcon + name + inverseName. Same icon picker as entry types. Add, rename, delete (guarded: IN_USE).

### World Theme

Controls applying to the current world:

- **Font** — select from curated open-source pairings (key → font name mapping; content/display font + UI chrome stays Inter). Options include at minimum: Lora, Crimson Pro, EB Garamond, Spectral, Source Serif 4, Literata.
- **Colour palette** — select from curated named palettes (e.g. "Ashwood," "Deep Ocean," "Candlelight") with optional accent colour and surface colour overrides (hex inputs).
- **Dark mode toggle** — per world.
- **Default icon weight** — applies to all EntryType and RelationType icons in this world unless overridden per type.

Theme is persisted in `WorldTheme` (one row per world). Applied immediately on change; no save button needed.

---

## Mobile & Tablet Compatibility

The app is a web application first. A native mobile app is out of scope. The goal is a responsive web experience that works well on tablets and remains usable on phones, with no effort spent polishing experiences that are inherently constrained by the platform.

### Layout adaptation

On tablet portrait and phone, the four-region shell collapses:

- The **mode rail** becomes a bottom tab bar or moves into a hamburger menu.
- The **main sidebar** becomes a swipeable drawer (closed by default on phone, open by default on tablet portrait).
- The **body** takes full width when the sidebar is closed.

The header persists across all breakpoints.

### Per-surface notes

**Phone** — primary use case is reading, browsing, and searching. Following relation links, viewing entry content, and light edits (title, tags, short text additions) are supported. Not optimised as a writing environment.

**Tablet portrait** — near-desktop experience. Sidebar drawer, full body width. Workable for most tasks.

**Tablet landscape / desktop** — full four-region layout. Primary editing target. All features fully supported.

### Component-specific behaviour

**Tiptap (Section blocks)** — works on mobile browsers but the editing experience is degraded: virtual keyboard displacement, fiddly text selection, toolbar conflicts with OS selection UI. This is accepted and not a target for remediation. Section editing is not blocked on mobile but is not optimised for it. No engineering effort should be spent improving the Tiptap mobile experience.

**Excalidraw (Sketch blocks)** — canvas interaction on phone is awkward without a stylus. On iPad with Apple Pencil the experience is good. Not blocked but not optimised for phone. The overlay/drawer pattern isolates this from the main entry flow.

**dnd-kit (block reordering)** — dnd-kit drag handles block reordering on desktop. On mobile, drag-to-reorder conflicts with page scrolling and is not used. Provide explicit **Move up / Move down** buttons on each block as the primary reordering mechanism on mobile viewports. The drag handle is hidden on mobile; the move buttons are hidden on desktop.

_When the geometry add-on is built:_ Leaflet's touch support is solid and geoman drawing tools work on touch. The geometry overlay will be a workable tablet experience, particularly with a stylus. See `addon-geometry.md` for mobile notes specific to that add-on.

---

## Aesthetic Direction

The application should feel like a well-designed reference volume: structured, typographically considered, and weighted with implied depth. Content regions breathe; chrome is compact.

- **Typography** — world content (entry titles, section prose) renders in the world's chosen serif. UI chrome (sidebar labels, buttons, config panels) uses Inter. The contrast between the two registers signals the boundary between tool and world.
- **Colour** — world theme accent colour is used sparingly: active tab indicator, selected entry highlight, the world chip in the header. Background surfaces are warm neutrals in dark mode, not cold grays.
- **Iconography** — Phosphor icons throughout (`@phosphor-icons/react`, MIT). App-level icons at `regular` weight. World EntryType and RelationType icons at world-configured weight (default `duotone`).
- **Motion** — entry tab open: subtle fade. Mode rail transition: none (instant). Block reorder: smooth drag shadow via dnd-kit defaults. Expand/collapse (search layers, config sections): short ease transition. No ambient or decorative animation.
- **Empty states** — communicate what goes here and how to begin. Never blank white rectangles.
- **Decoration** — none. The world's content is the decoration.
