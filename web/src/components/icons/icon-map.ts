// Full Phosphor icon registry, name → component. This module pulls in the
// entire icon set, so it is ONLY loaded via dynamic import (see WorldIcon and
// the settings IconPicker) — never import it statically from app code.

import * as Phosphor from '@phosphor-icons/react';
import type { Icon } from '@phosphor-icons/react';

const NON_ICONS = new Set(['IconContext', 'IconBase', 'SSR']);

export const ICON_MAP: Record<string, Icon> = {};
for (const [name, value] of Object.entries(Phosphor)) {
  if (NON_ICONS.has(name)) continue;
  if (typeof value === 'object' || typeof value === 'function') {
    ICON_MAP[name] = value as Icon;
  }
}

export const ICON_NAMES = Object.keys(ICON_MAP).sort();
