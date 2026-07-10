// World theme editor. Every control applies instantly: optimistic write into
// the theme query cache (ThemeProvider re-derives CSS custom properties) plus
// a debounced PUT. No save button. Palette selection is hex-matched — the
// schema stores only accent/surface hexes; unmatched values show as Custom.

import { useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Switch, ToggleGroup } from "radix-ui";
import { keys } from "../../api/keys";
import { putTheme } from "../../api/endpoints";
import type { WorldTheme } from "../../api/types";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { useWorldTheme } from "../../theme/ThemeProvider";
import { FONT_OPTIONS, fontByKey } from "../../theme/fonts";
import { PALETTES, paletteForTheme } from "../../theme/palettes";
import { TextInput } from "../../components/TextInput";
import { TID } from "../../testids";
import styles from "./ThemePanel.module.css";

const WEIGHTS = ["thin", "light", "regular", "bold", "fill", "duotone"];
const UI_SCALES: WorldTheme["uiScale"][] = ["small", "medium", "large"];
const PUT_DEBOUNCE_MS = 400;

export function ThemePanel() {
  const worldId = useWorkspaceStore((s) => s.activeWorldId);
  const queryClient = useQueryClient();
  const { data: theme } = useWorldTheme(worldId);
  const timer = useRef<number | null>(null);

  if (!worldId || !theme) return null;

  const apply = (patch: Partial<WorldTheme>) => {
    const next = { ...theme, ...patch };
    queryClient.setQueryData(keys.theme(worldId), next);
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      timer.current = null;
      const { worldId: _w, ...body } = next;
      putTheme(worldId, body).catch(() => {
        queryClient.invalidateQueries({ queryKey: keys.theme(worldId) });
      });
    }, PUT_DEBOUNCE_MS);
  };

  const selectedPalette = paletteForTheme(theme.accentColor, theme.surfaceColor, theme.darkMode);

  return (
    <div className={styles.panel}>
      <section className={styles.group}>
        <h3 className={styles.label}>Content font</h3>
        <select
          className={styles.fontSelect}
          value={fontByKey(theme.fontFamily).key}
          onChange={(e) => apply({ fontFamily: e.target.value })}
          data-testid={TID.themeFontSelect}>
          {FONT_OPTIONS.map((f) => (
            <option key={f.key} value={f.key}>
              {f.label}
            </option>
          ))}
        </select>
        <p
          className={styles.fontPreview}
          style={{ fontFamily: fontByKey(theme.fontFamily).cssFamily }}>
          The quick brown wyvern vaults the sleeping keep.
        </p>
      </section>

      <section className={styles.group}>
        <h3 className={styles.label}>Palette</h3>
        <div className={styles.palettes}>
          {PALETTES.map((p) => (
            <button
              key={p.key}
              type="button"
              className={[
                styles.palette,
                selectedPalette?.key === p.key ? styles.paletteActive : "",
              ].join(" ")}
              onClick={() =>
                apply({
                  accentColor: p.accent,
                  surfaceColor: theme.darkMode ? p.surfaceDark : p.surfaceLight,
                })
              }
              data-testid={TID.themePalette(p.key)}>
              <span className={styles.swatch} style={{ background: p.accent }} />
              <span
                className={styles.swatch}
                style={{ background: theme.darkMode ? p.surfaceDark : p.surfaceLight }}
              />
              <span className={styles.paletteLabel}>{p.label}</span>
            </button>
          ))}
        </div>
        {!selectedPalette && (theme.accentColor || theme.surfaceColor) && (
          <p className={styles.hint}>Custom colours in use.</p>
        )}
        <div className={styles.hexRow}>
          <label className={styles.hexLabel}>
            Accent
            <TextInput
              placeholder="#8a5a2b"
              value={theme.accentColor ?? ""}
              onChange={(e) =>
                apply({ accentColor: e.target.value === "" ? null : e.target.value })
              }
              data-testid={TID.themeAccentInput}
            />
          </label>
          <label className={styles.hexLabel}>
            Surface
            <TextInput
              placeholder="auto"
              value={theme.surfaceColor ?? ""}
              onChange={(e) =>
                apply({ surfaceColor: e.target.value === "" ? null : e.target.value })
              }
              data-testid={TID.themeSurfaceInput}
            />
          </label>
        </div>
      </section>

      <section className={styles.group}>
        <h3 className={styles.label}>Dark mode</h3>
        <Switch.Root
          className={styles.switch}
          checked={theme.darkMode}
          onCheckedChange={(darkMode) => {
            // Keep palette surfaces in sync across the mode flip when the
            // current surface hex-matches the selected palette.
            const patch: Partial<WorldTheme> = { darkMode };
            if (selectedPalette) {
              patch.surfaceColor = darkMode
                ? selectedPalette.surfaceDark
                : selectedPalette.surfaceLight;
            }
            apply(patch);
          }}
          data-testid={TID.themeDarkToggle}>
          <Switch.Thumb className={styles.thumb} />
        </Switch.Root>
      </section>

      <section className={styles.group}>
        <h3 className={styles.label}>UI scale</h3>
        <ToggleGroup.Root
          type="single"
          value={theme.uiScale}
          onValueChange={(v) => {
            if (v) apply({ uiScale: v as WorldTheme["uiScale"] });
          }}
          className={styles.scales}>
          {UI_SCALES.map((scale) => (
            <ToggleGroup.Item
              key={scale}
              value={scale}
              className={styles.scaleItem}
              data-testid={TID.themeUiScale(scale)}>
              {scale}
            </ToggleGroup.Item>
          ))}
        </ToggleGroup.Root>
      </section>

      <section className={styles.group}>
        <h3 className={styles.label}>Default icon weight</h3>
        <ToggleGroup.Root
          type="single"
          value={theme.defaultIconWeight}
          onValueChange={(v) => {
            if (v) apply({ defaultIconWeight: v });
          }}
          className={styles.weights}>
          {WEIGHTS.map((w) => (
            <ToggleGroup.Item
              key={w}
              value={w}
              className={styles.weightItem}
              data-testid={TID.themeIconWeight(w)}>
              {w}
            </ToggleGroup.Item>
          ))}
        </ToggleGroup.Root>
      </section>
    </div>
  );
}
