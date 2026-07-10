// Central data-testid registry. Every interactive control referenced by future
// Playwright tests takes its testid from here — never inline strings.

export const TID = {
  // shell
  worldSwitcherTrigger: "world-switcher-trigger",
  worldSwitcherItem: (worldId: string) => `world-switcher-item-${worldId}`,
  worldSwitcherNew: "world-switcher-new",
  settingsButton: "settings-button",
  modeRailLibrary: "mode-rail-library",
  sidebarExpand: "sidebar-expand",
  sidebarResizeHandle: "sidebar-resize-handle",

  // first run / world create
  createWorldName: "create-world-name",
  createWorldSubmit: "create-world-submit",

  // sidebar
  searchInput: "search-input",
  searchFilterToggle: "search-filter-toggle",
  filterTypeChip: (slug: string) => `filter-type-${slug}`,
  filterTagChip: (tag: string) => `filter-tag-${tag}`,
  sortSelect: "sort-select",
  groupBySelect: "group-by-select",
  densityToggle: (density: string) => `density-${density}`,
  resultCard: (entryId: string) => `result-${entryId}`,
  newEntryButton: "new-entry-button",
  newEntryTitle: "new-entry-title",
  newEntryType: "new-entry-type",
  newEntrySubmit: "new-entry-submit",

  // tabs
  tab: (entryId: string) => `tab-${entryId}`,
  tabClose: (entryId: string) => `tab-close-${entryId}`,
  tabOverflowTrigger: "tab-overflow-trigger",
  tabOverflowItem: (entryId: string) => `tab-overflow-item-${entryId}`,

  // entry view
  entryEdit: "entry-edit",
  entrySave: "entry-save",
  entryCancel: "entry-cancel",
  entryTitleInput: "entry-title-input",
  entryTypeBadge: "entry-type-badge",
  entryTagInput: "entry-tag-input",
  entryMenu: "entry-menu",
  entryDelete: "entry-delete",
  discardConfirm: "discard-confirm",
  discardCancel: "discard-cancel",

  // blocks
  block: (key: string) => `block-${key}`,
  blockDragHandle: (key: string) => `block-drag-${key}`,
  blockDelete: (key: string) => `block-delete-${key}`,
  blockDuplicate: (key: string) => `block-duplicate-${key}`,
  blockSplit: (key: string) => `block-split-${key}`,
  blockToolbarToggle: (key: string) => `block-toolbar-toggle-${key}`,
  blockMerge: (key: string) => `block-merge-${key}`,
  insertBlock: (afterKey: string) => `insert-after-${afterKey}`,
  insertPickerSection: "insert-picker-section",
  insertPickerImage: "insert-picker-image",
  insertPickerSketch: "insert-picker-sketch",
  sketchOpen: (key: string) => `sketch-open-${key}`,
  sketchSave: "sketch-save",
  sketchClose: "sketch-close",
  imageReplace: (key: string) => `image-replace-${key}`,

  // relations
  relationCard: (relationId: string) => `relation-${relationId}`,
  relationAdd: "relation-add",
  relationTypeSelect: "relation-type-select",
  relationDirectionToggle: "relation-direction-toggle",
  relationTargetInput: "relation-target-input",
  relationSubmit: "relation-submit",
  relationRemove: (relationId: string) => `relation-remove-${relationId}`,

  // settings
  settingsNav: (section: string) => `settings-nav-${section}`,
  settingsClose: "settings-close",
  worldRow: (worldId: string) => `settings-world-${worldId}`,
  worldRename: (worldId: string) => `settings-world-rename-${worldId}`,
  worldDelete: (worldId: string) => `settings-world-delete-${worldId}`,
  entryTypeRow: (id: string) => `settings-entry-type-${id}`,
  entryTypeAdd: "settings-entry-type-add",
  relationTypeRow: (id: string) => `settings-relation-type-${id}`,
  relationTypeAdd: "settings-relation-type-add",
  iconPickerSearch: "icon-picker-search",
  iconPickerItem: (name: string) => `icon-picker-${name}`,
  themeFontSelect: "theme-font-select",
  themePalette: (key: string) => `theme-palette-${key}`,
  themeAccentInput: "theme-accent-input",
  themeSurfaceInput: "theme-surface-input",
  themeDarkToggle: "theme-dark-toggle",
  themeIconWeight: (weight: string) => `theme-icon-weight-${weight}`,
} as const;
