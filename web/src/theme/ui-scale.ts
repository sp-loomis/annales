import { useWorkspaceStore } from "../stores/workspaceStore";
import { useWorldTheme } from "./ThemeProvider";

export type UiScale = "small" | "medium" | "large";

const UI_SCALE_FACTORS: Record<UiScale, number> = {
  small: 1,
  medium: 1.25,
  large: 1.4,
};

export function uiScaleFactor(scale: UiScale): number {
  return UI_SCALE_FACTORS[scale];
}

export function scalePx(base: number, scale: UiScale): number {
  return Math.round(base * uiScaleFactor(scale));
}

export function scalePxSoft(base: number, scale: UiScale, intensity = 0.55): number {
  const factor = uiScaleFactor(scale);
  const softFactor = 1 + (factor - 1) * intensity;
  return Math.round(base * softFactor);
}

export function useUiScale(): UiScale {
  const worldId = useWorkspaceStore((s) => s.activeWorldId);
  const { data: theme } = useWorldTheme(worldId);
  return theme?.uiScale ?? "small";
}

export function useScaledPx(base: number): number {
  const scale = useUiScale();
  return scalePx(base, scale);
}

export function useScaledPxSoft(base: number, intensity = 0.55): number {
  const scale = useUiScale();
  return scalePxSoft(base, scale, intensity);
}
