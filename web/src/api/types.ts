// Hand-modeled DTOs matching the backend route serializers (src/routes/*.ts).
// Geometry and date-range shapes are typed but never rendered — those add-ons
// are deferred; the fields exist so EntryDetail matches the wire shape.

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export interface World {
  id: string;
  name: string;
}

export type IconWeight = "thin" | "light" | "regular" | "bold" | "fill" | "duotone";

export interface EntryType {
  id: string;
  worldId: string;
  name: string;
  slug: string;
  iconName: string | null;
  iconWeight: string | null;
}

export interface RelationType {
  id: string;
  worldId: string;
  name: string;
  inverseName: string | null;
  iconName: string | null;
  iconWeight: string | null;
}

export interface EntrySummary {
  id: string;
  worldId: string;
  /** EntryType slug, not id. */
  type: string;
  title: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

/** Loose ProseMirror document JSON. */
export interface PMNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: PMNode[];
  marks?: { type: string; attrs?: Record<string, unknown> }[];
  text?: string;
}

export interface Section {
  id: string;
  order: number;
  contentJson: PMNode | null;
}

export type ArtifactStatus = "pending" | "ready" | "failed";

export interface ImageMeta {
  id: string;
  label: string | null;
  order: number;
  status: ArtifactStatus;
}

export interface SketchMeta {
  id: string;
  label: string | null;
  order: number;
  status: ArtifactStatus;
}

export interface GeometryMeta {
  id: string;
  crsId: string;
  label: string | null;
  order: number;
  status: ArtifactStatus;
  bboxes: unknown[];
  properties: unknown;
}

export interface DateRangeMeta {
  id: string;
  calendarId: string;
  rawComponents: Record<string, number | string>;
  tickStart: number | null;
  tickEnd: number | null;
  precisionTier: string | null;
  label: string | null;
  displayStyle: "pretty" | "short";
}

export interface RelationView {
  id: string;
  direction: "out" | "in";
  fromId: string;
  toId: string;
  type: {
    id: string;
    name: string;
    inverseName: string | null;
    iconName: string | null;
    iconWeight: string | null;
  };
  otherEntry: {
    id: string;
    title: string;
    /** EntryType slug. */
    type: string;
    iconName: string | null;
    iconWeight: string | null;
  };
}

export interface EntryDetail extends EntrySummary {
  sections: Section[];
  images: ImageMeta[];
  sketches: SketchMeta[];
  geometries: GeometryMeta[];
  dateRanges: DateRangeMeta[];
  relations: RelationView[];
}

export interface PresignedDownload {
  url: string;
  expiresAt: string;
}

export interface PresignedUpload {
  url: string;
  method: "PUT";
  expiresAt: string;
}

export interface ArtifactDetail {
  id: string;
  entryId: string;
  label: string | null;
  order: number;
  status: ArtifactStatus;
  download: PresignedDownload | null;
  /** images only */
  contentType?: string;
  /** images only */
  thumbnail?: PresignedDownload | null;
}

export interface ArtifactWithUpload extends ArtifactDetail {
  upload: PresignedUpload;
}

export interface SearchMatch {
  sourceType: string;
  sourceId: string;
  /** ts_headline output — plain text with <b>…</b> highlights. */
  snippet: string;
}

export interface SearchResult {
  entryId: string;
  title: string;
  /** EntryType slug. */
  type: string;
  rank?: number;
  matches: SearchMatch[];
}

export interface WorldTheme {
  worldId: string;
  fontFamily: string | null;
  accentColor: string | null;
  surfaceColor: string | null;
  darkMode: boolean;
  defaultIconWeight: string;
  uiScale: "small" | "medium" | "large";
}

export type Density = "compact" | "comfortable" | "detailed";
export type SortMode = "updated" | "title-asc" | "title-desc";
export type GroupBy = "none" | "type" | "first-letter";

/** Client-defined shape stored in WorkspaceState.sidebarState (opaque Json to the server). */
export interface SidebarPrefs {
  query: string;
  typeSlugs: string[];
  tags: string[];
  sort: SortMode;
  groupBy: GroupBy;
  density: Density;
  filtersOpen: boolean;
}

export interface WorkspaceStateDto {
  worldId: string;
  openEntryIds: string[];
  sidebarState: Partial<SidebarPrefs> | null;
  updatedAt: string | null;
}

export interface RelationRow {
  id: string;
  fromId: string;
  toId: string;
  typeId: string;
}

// ---- timelines & calendars ----
// The definition mirrors the backend authoring shape validated by
// src/lib/calendar/validate.ts. Numeric fields may be a constant or a DSL rule
// ({ dsl }); the top-level param must stay fully static.

export interface DslAttachment {
  dsl: string;
}

/** A field that is either a plain constant or a DSL rule. */
export type Attach<T> = T | DslAttachment;

/** A Named param/derived value: a bare id, or an id with a display override. */
export type NamedValueDef = string | { value: string; display?: string };

export interface CalendarParam {
  name: string;
  type: "number" | "named";
  /** Named only. */
  values?: NamedValueDef[];
  /** Named only: active-domain length (defaults to values.length). */
  count?: Attach<number>;
  /** Number only. */
  range?: { from: Attach<number | null>; to: Attach<number | null> };
  /** Display/tick direction; defaults to 1. */
  step?: Attach<1 | -1>;
  /** Terminal (finest) param only: ticks per unit. */
  unitTicks?: Attach<number>;
}

export interface DerivedFieldDef {
  name: string;
  type: "number" | "boolean" | "named";
  values?: NamedValueDef[];
  expr: DslAttachment;
}

export interface CalendarFormat {
  pretty?: Record<string, DslAttachment>;
  short?: Record<string, DslAttachment>;
}

export interface CalendarDefinition {
  version: 1;
  /** Coarsest → finest. */
  params: CalendarParam[];
  /** Full param tuple at tick 0. */
  epoch: Record<string, number | string>;
  derivedFields?: DerivedFieldDef[];
  format?: CalendarFormat;
}

export interface Timeline {
  id: string;
  worldId: string;
  name: string;
  params: unknown;
}

export interface Calendar {
  id: string;
  timelineId: string;
  name: string;
  definition: CalendarDefinition;
}

export interface CalendarConvertResult {
  date: Record<string, number | string>;
  tickStart: number | null;
  tickEnd: number | null;
  pretty: string;
  short: string;
  /** Present only when the date tuple is full. */
  derived?: Record<string, number | boolean | string>;
}
