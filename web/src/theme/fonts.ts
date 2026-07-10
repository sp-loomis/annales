// Curated world-content font pairings. The stored WorldTheme.fontFamily is one
// of these keys; the CSS family strings match the @fontsource imports in
// main.tsx (browsers download only the family actually used).

export interface FontOption {
  key: string;
  label: string;
  cssFamily: string;
}

export const FONT_OPTIONS: FontOption[] = [
  { key: 'lora', label: 'Lora', cssFamily: "'Lora Variable'" },
  { key: 'crimson-pro', label: 'Crimson Pro', cssFamily: "'Crimson Pro Variable'" },
  { key: 'eb-garamond', label: 'EB Garamond', cssFamily: "'EB Garamond Variable'" },
  { key: 'spectral', label: 'Spectral', cssFamily: "'Spectral'" },
  { key: 'source-serif-4', label: 'Source Serif 4', cssFamily: "'Source Serif 4 Variable'" },
  { key: 'literata', label: 'Literata', cssFamily: "'Literata Variable'" },
];

export const DEFAULT_FONT_KEY = 'lora';

export function fontByKey(key: string | null): FontOption {
  return FONT_OPTIONS.find((f) => f.key === key) ?? FONT_OPTIONS[0];
}
