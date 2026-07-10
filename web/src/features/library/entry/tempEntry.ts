const TEMP_ENTRY_PREFIX = "temp-entry:";

export function makeTempEntryId(): string {
  return `${TEMP_ENTRY_PREFIX}${crypto.randomUUID()}`;
}

export function isTempEntryId(entryId: string): boolean {
  return entryId.startsWith(TEMP_ENTRY_PREFIX);
}

export function getUntitledLabel(title: string): string {
  return title.trim() === "" ? "Untitled" : title;
}
