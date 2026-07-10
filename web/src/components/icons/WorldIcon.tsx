// Renders a world-configured icon by Phosphor name string, at the type's
// weight or the world default. The full icon map is a separate lazy chunk;
// until it loads (or when the name is unknown) a neutral dot renders so
// layout never jumps.

import { useEffect, useReducer } from 'react';
import type { Icon, IconWeight } from '@phosphor-icons/react';
import { useWorldTheme } from '../../theme/ThemeProvider';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import styles from './WorldIcon.module.css';

let iconMap: Record<string, Icon> | null = null;
let iconMapPromise: Promise<void> | null = null;
const listeners = new Set<() => void>();

function loadIconMap(): void {
  if (iconMap || iconMapPromise) return;
  iconMapPromise = import('./icon-map').then((m) => {
    iconMap = m.ICON_MAP;
    listeners.forEach((l) => l());
    listeners.clear();
  });
}

export function useIconMap(): Record<string, Icon> | null {
  const [, force] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    if (iconMap) return;
    loadIconMap();
    listeners.add(force);
    return () => {
      listeners.delete(force);
    };
  }, []);
  return iconMap;
}

const VALID_WEIGHTS = new Set(['thin', 'light', 'regular', 'bold', 'fill', 'duotone']);

export function WorldIcon({
  iconName,
  iconWeight,
  size = 16,
  className,
}: {
  iconName: string | null | undefined;
  /** Per-type override; falls back to the world's defaultIconWeight. */
  iconWeight?: string | null;
  size?: number;
  className?: string;
}) {
  const map = useIconMap();
  const worldId = useWorkspaceStore((s) => s.activeWorldId);
  const { data: theme } = useWorldTheme(worldId);

  const Component = iconName && map ? map[iconName] : undefined;
  if (!Component) {
    return (
      <span
        className={[styles.fallback, className].filter(Boolean).join(' ')}
        style={{ width: size, height: size }}
        aria-hidden
      />
    );
  }

  const rawWeight = iconWeight ?? theme?.defaultIconWeight ?? 'duotone';
  const weight = (VALID_WEIGHTS.has(rawWeight) ? rawWeight : 'duotone') as IconWeight;
  return <Component size={size} weight={weight} className={className} />;
}
