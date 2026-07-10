// Curated named palettes. WorldTheme stores only accentColor/surfaceColor
// hexes — selecting a palette writes its hexes for the current mode; the
// theme editor shows a palette as selected by hex match ("Custom" otherwise).

export interface Palette {
  key: string;
  label: string;
  accent: string;
  surfaceLight: string;
  surfaceDark: string;
}

export const PALETTES: Palette[] = [
  { key: 'ashwood', label: 'Ashwood', accent: '#8a5a2b', surfaceLight: '#f6f2ea', surfaceDark: '#201b15' },
  { key: 'deep-ocean', label: 'Deep Ocean', accent: '#2e6f8e', surfaceLight: '#eef3f4', surfaceDark: '#161f24' },
  { key: 'candlelight', label: 'Candlelight', accent: '#b8860b', surfaceLight: '#faf5e6', surfaceDark: '#241d10' },
  { key: 'verdigris', label: 'Verdigris', accent: '#3d7a5f', surfaceLight: '#eff4ef', surfaceDark: '#17201a' },
  { key: 'hearth', label: 'Hearth', accent: '#a34a2a', surfaceLight: '#f8f0e9', surfaceDark: '#241812' },
  { key: 'violet-hour', label: 'Violet Hour', accent: '#6d5a8e', surfaceLight: '#f2f0f6', surfaceDark: '#1c1822' },
];

export function paletteForTheme(
  accent: string | null,
  surface: string | null,
  darkMode: boolean
): Palette | null {
  if (!accent) return null;
  return (
    PALETTES.find(
      (p) =>
        p.accent.toLowerCase() === accent.toLowerCase() &&
        (surface === null ||
          (darkMode ? p.surfaceDark : p.surfaceLight).toLowerCase() === surface.toLowerCase())
    ) ?? null
  );
}
