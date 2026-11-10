// The theme of the Community Notes page: light, or dark as on X. Each theme has one of the Seams
// site's grain fields (./grain) for the hero, and colours for the notes app.
// The nav has a picker for the themes (ThemePicker). The choice is a per-visitor convenience: it
// stays in this browser's localStorage, and `?theme=<name>` in the address picks one for a shared
// link. The page puts the theme on the root element as `data-theme`, so the notes app's dialogs,
// which open on document.body, follow it too. The hero and the nav keep their own colours.

import { useSyncExternalStore } from 'react';
import { grainFieldSource, type GrainFieldName } from './grain/fields';

/** The themes, in the picker's order. "Dark mode" is the dark blue of Twitter's dark mode (X's Dim). */
export const THEMES = {
  light: { label: 'Light mode', field: 'apricot-beam' },
  dark: { label: 'Dark mode', field: 'aqua-evergreen' },
} as const satisfies Record<string, { label: string; field: GrainFieldName }>;

export type ThemeName = keyof typeof THEMES;

export const THEME_NAMES = Object.keys(THEMES) as ThemeName[];

/** The theme of the page until the visitor picks another. */
const DEFAULT_THEME: ThemeName = 'light';

const STORAGE_KEY = 'speak-to-sign:theme';

function isThemeName(value: string | null): value is ThemeName {
  return value !== null && Object.hasOwn(THEMES, value);
}

function firstTheme(): ThemeName {
  const asked = new URLSearchParams(window.location.search).get('theme');
  if (isThemeName(asked)) return asked;
  try {
    const kept = localStorage.getItem(STORAGE_KEY);
    if (isThemeName(kept)) return kept;
  } catch {
    // No storage (a private window, or storage turned off).
  }
  return DEFAULT_THEME;
}

let current: ThemeName | null = null;
const listeners = new Set<() => void>();

function read(): ThemeName {
  current ??= firstTheme();
  return current;
}

export function setTheme(theme: ThemeName): void {
  current = theme;
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // The choice holds until the page closes.
  }
  for (const listener of listeners) listener();
}

export function useTheme(): ThemeName {
  return useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    read,
  );
}

/**
 * How dark the shade over the left of the hero is, 0 to 0.34: none on a dark field, more on a
 * light one, so the white text and the nav stay readable on every field. It follows the
 * luminance of the field's left part, where the text is.
 */
export function fieldScrim(field: GrainFieldName): number {
  const { grid } = grainFieldSource(field);
  const linear = (channel: number) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  let sum = 0;
  let cells = 0;
  for (let y = 0; y < 12; y += 1) {
    for (let x = 0; x < 7; x += 1) {
      const i = (y * 12 + x) * 3;
      sum += 0.2126 * linear(grid[i] ?? 0) + 0.7152 * linear(grid[i + 1] ?? 0) + 0.0722 * linear(grid[i + 2] ?? 0);
      cells += 1;
    }
  }
  const luminance = sum / cells;
  return Math.min(0.34, Math.max(0, (luminance - 0.18) * 0.9));
}
