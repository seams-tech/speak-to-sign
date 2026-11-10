// The theme of the Community Notes page: light, or dark as on X. Each theme has one of the Seams
// site's grain fields (./grain) for the hero, and colours for the notes app.
// The nav has a picker (ThemePicker) with three choices: Light mode, Dark mode, and System, which
// follows the light or dark setting of the visitor's system and changes when that setting changes.
// The choice is a per-visitor convenience: it stays in this browser's localStorage, and
// `?theme=<choice>` in the address picks one for a shared link. The page puts the theme (light or
// dark, never "system") on the root element as `data-theme`, so the notes app's dialogs, which
// open on document.body, follow it too. The hero and the nav keep their own colours.

import { useSyncExternalStore } from 'react';
import { grainFieldSource, type GrainFieldName } from './grain/fields';

/** The themes. "Dark mode" is X's black (Lights out). */
export const THEMES = {
  light: { label: 'Light mode', field: 'apricot-beam' },
  dark: { label: 'Dark mode', field: 'onyx-black' },
} as const satisfies Record<string, { label: string; field: GrainFieldName }>;

export type ThemeName = keyof typeof THEMES;

/** The picker's choices, in its order: a theme, or the system's setting. */
export const THEME_CHOICES = ['light', 'dark', 'system'] as const;

export type ThemeChoice = (typeof THEME_CHOICES)[number];

export function choiceLabel(choice: ThemeChoice): string {
  return choice === 'system' ? 'System' : THEMES[choice].label;
}

/** The choice of the page until the visitor picks another. */
const DEFAULT_CHOICE: ThemeChoice = 'light';

const STORAGE_KEY = 'speak-to-sign:theme';

const SYSTEM_DARK = '(prefers-color-scheme: dark)';

function isThemeChoice(value: string | null): value is ThemeChoice {
  return THEME_CHOICES.some((choice) => choice === value);
}

function firstChoice(): ThemeChoice {
  const asked = new URLSearchParams(window.location.search).get('theme');
  if (isThemeChoice(asked)) return asked;
  try {
    const kept = localStorage.getItem(STORAGE_KEY);
    if (isThemeChoice(kept)) return kept;
  } catch {
    // No storage (a private window, or storage turned off).
  }
  return DEFAULT_CHOICE;
}

let current: ThemeChoice | null = null;
const listeners = new Set<() => void>();

function readChoice(): ThemeChoice {
  current ??= firstChoice();
  return current;
}

function readTheme(): ThemeName {
  const choice = readChoice();
  if (choice !== 'system') return choice;
  return window.matchMedia(SYSTEM_DARK).matches ? 'dark' : 'light';
}

/** Calls `onChange` when the choice changes, and when the system's setting changes. */
function subscribe(onChange: () => void): () => void {
  const system = window.matchMedia(SYSTEM_DARK);
  listeners.add(onChange);
  system.addEventListener('change', onChange);
  return () => {
    listeners.delete(onChange);
    system.removeEventListener('change', onChange);
  };
}

export function setTheme(choice: ThemeChoice): void {
  current = choice;
  try {
    localStorage.setItem(STORAGE_KEY, choice);
  } catch {
    // The choice holds until the page closes.
  }
  for (const listener of listeners) listener();
}

/** The visitor's choice in the picker. */
export function useThemeChoice(): ThemeChoice {
  return useSyncExternalStore(subscribe, readChoice);
}

/** The theme that the page shows: for "System", the system's light or dark setting. */
export function useTheme(): ThemeName {
  return useSyncExternalStore(subscribe, readTheme);
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
