// The gradient of the Community Notes hero: one of the Seams site's grain fields (./grain). The
// nav has a picker for all of them. The choice is a per-visitor convenience: it stays in this
// browser's localStorage, and `?field=<name>` in the address picks one for a shared link.

import { useSyncExternalStore } from 'react';
import { GRAIN_FIELD_NAMES, grainFieldSource, type GrainFieldName } from './grain/fields';

/** The field of the hero until the visitor picks another. */
export const DEFAULT_FIELD: GrainFieldName = 'apricot-beam';

/** The field of the Seams home hero. The menu tags it. */
export const SEAMS_HOME_FIELD: GrainFieldName = 'teal-peach-wisp';

// v2: the default changed to Apricot Beam, so an older pick does not hide it.
const STORAGE_KEY = 'speak-to-sign:hero-field:v2';

function isFieldName(value: string | null): value is GrainFieldName {
  return value !== null && (GRAIN_FIELD_NAMES as string[]).includes(value);
}

function firstField(): GrainFieldName {
  const asked = new URLSearchParams(window.location.search).get('field');
  if (isFieldName(asked)) return asked;
  try {
    const kept = localStorage.getItem(STORAGE_KEY);
    if (isFieldName(kept)) return kept;
  } catch {
    // No storage (a private window, or storage turned off).
  }
  return DEFAULT_FIELD;
}

let current: GrainFieldName | null = null;
const listeners = new Set<() => void>();

function read(): GrainFieldName {
  current ??= firstField();
  return current;
}

export function setHeroField(field: GrainFieldName): void {
  current = field;
  try {
    localStorage.setItem(STORAGE_KEY, field);
  } catch {
    // The choice holds until the page closes.
  }
  for (const listener of listeners) listener();
}

export function useHeroField(): GrainFieldName {
  return useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    read,
  );
}

/** "teal-peach-wisp" → "Teal Peach Wisp". */
export function fieldLabel(field: GrainFieldName): string {
  return field
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
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
