// The theme picker, in the nav's brand pill: a small round button with a picture of the hero's
// grain field, which opens a menu of the page's themes, each with a picture of its field.
// The menu is a listbox: the arrow keys move through it and change the theme at once, Enter or
// Escape closes it, and a click outside closes it too.

import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { IconCheck } from '@tabler/icons-react';
import { grainFieldSource, type GrainFieldName } from './grain/fields';
import { setTheme, THEME_NAMES, THEMES, useTheme, type ThemeName } from './theme';

const thumbs = new Map<GrainFieldName, string>();

/**
 * A picture of a field: its 12 x 12 colour grid as a PNG. The browser smooths it when it scales
 * it up, so a small swatch shows the field's soft gradient.
 */
function fieldThumb(field: GrainFieldName): string {
  const kept = thumbs.get(field);
  if (kept) return kept;
  const { grid } = grainFieldSource(field);
  const canvas = document.createElement('canvas');
  canvas.width = 12;
  canvas.height = 12;
  const context = canvas.getContext('2d');
  if (!context) return '';
  const image = context.createImageData(12, 12);
  for (let cell = 0; cell < 144; cell += 1) {
    image.data[cell * 4] = grid[cell * 3] ?? 0;
    image.data[cell * 4 + 1] = grid[cell * 3 + 1] ?? 0;
    image.data[cell * 4 + 2] = grid[cell * 3 + 2] ?? 0;
    image.data[cell * 4 + 3] = 255;
  }
  context.putImageData(image, 0, 0);
  const url = canvas.toDataURL();
  thumbs.set(field, url);
  return url;
}

function Swatch({ field, className }: { field: GrainFieldName; className: string }) {
  const thumb = fieldThumb(field);
  return (
    <span
      className={className}
      style={{ backgroundColor: grainFieldSource(field).base, backgroundImage: thumb ? `url(${thumb})` : undefined }}
      aria-hidden="true"
    />
  );
}

export function ThemePicker() {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  // The option that the keyboard or the pointer is on.
  const [active, setActive] = useState<ThemeName>(theme);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const baseId = useId();
  const listId = `${baseId}-list`;
  const optionId = (name: ThemeName) => `${baseId}-${name}`;

  // Opening puts the keyboard in the list, on the chosen theme.
  useEffect(() => {
    if (!open) return;
    setActive(theme);
    listRef.current?.focus({ preventScroll: true });
    // Only when the menu opens: the chosen theme changes while it is open.
  }, [open]);

  // The active option stays in sight in the list. Only the list scrolls, never the page.
  useEffect(() => {
    const list = listRef.current;
    const option = open ? document.getElementById(optionId(active)) : null;
    if (!list || !option) return;
    if (option.offsetTop < list.scrollTop) list.scrollTop = option.offsetTop;
    else if (option.offsetTop + option.offsetHeight > list.scrollTop + list.clientHeight) {
      list.scrollTop = option.offsetTop + option.offsetHeight - list.clientHeight;
    }
  });

  // A press outside the picker closes the menu.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) buttonRef.current?.focus({ preventScroll: true });
  };

  // The arrow keys choose as they move, so the page shows each theme in turn.
  const move = (to: ThemeName | undefined) => {
    if (!to) return;
    setActive(to);
    setTheme(to);
  };

  const onListKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = THEME_NAMES.indexOf(active);
    const last = THEME_NAMES.length - 1;
    switch (event.key) {
      case 'ArrowDown':
        move(THEME_NAMES[Math.min(last, index + 1)]);
        break;
      case 'ArrowUp':
        move(THEME_NAMES[Math.max(0, index - 1)]);
        break;
      case 'Home':
        move(THEME_NAMES[0]);
        break;
      case 'End':
        move(THEME_NAMES[last]);
        break;
      case 'Enter':
      case ' ':
        setTheme(active);
        close(true);
        break;
      case 'Escape':
        close(true);
        break;
      case 'Tab':
        setOpen(false);
        return;
      default:
        return;
    }
    event.preventDefault();
    event.stopPropagation();
  };

  const onButtonKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setOpen(true);
    }
  };

  return (
    <div className="ss-field-pick" ref={rootRef} data-open={open || undefined}>
      <button
        ref={buttonRef}
        type="button"
        className="ss-field-button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={`Theme: ${THEMES[theme].label}`}
        title={THEMES[theme].label}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={onButtonKey}
      >
        <Swatch field={THEMES[theme].field} className="ss-field-swatch" />
      </button>
      {open && (
        <div className="ss-field-menu">
          <p className="ss-field-menu-head" aria-hidden="true">
            Theme
          </p>
          <div
            ref={listRef}
            id={listId}
            className="ss-field-list"
            role="listbox"
            tabIndex={-1}
            aria-label="Theme"
            aria-activedescendant={optionId(active)}
            onKeyDown={onListKey}
          >
            {THEME_NAMES.map((name) => (
              <div
                key={name}
                id={optionId(name)}
                role="option"
                aria-selected={name === theme}
                className={`ss-field-option ${name === active ? 'ss-field-option-active' : ''}`}
                onPointerEnter={() => setActive(name)}
                onClick={() => {
                  setTheme(name);
                  close(true);
                }}
              >
                <Swatch field={THEMES[name].field} className="ss-field-thumb" />
                <span className="ss-field-option-name">{THEMES[name].label}</span>
                {name === theme && <IconCheck className="ss-field-check" size={15} stroke={2.4} aria-hidden="true" />}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
