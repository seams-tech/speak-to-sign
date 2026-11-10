// The theme picker, in the nav's brand pill: a small round button with a picture of the chosen
// theme, which opens a menu of the page's choices: Light mode and Dark mode, each with a picture
// of its grain field, and System, whose picture is half of each field.
// The menu is a listbox: the arrow keys move through it and change the theme at once, Enter or
// Escape closes it, and a click outside closes it too.

import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { IconCheck } from '@tabler/icons-react';
import { grainFieldSource, type GrainFieldName } from './grain/fields';
import { choiceLabel, setTheme, THEME_CHOICES, THEMES, useThemeChoice, type ThemeChoice } from './theme';

const thumbs = new Map<ThemeChoice, string>();

/** A field's 12 x 12 colour grid on a canvas of 12 x 12 pixels. */
function fieldCanvas(field: GrainFieldName): HTMLCanvasElement | null {
  const { grid } = grainFieldSource(field);
  const canvas = document.createElement('canvas');
  canvas.width = 12;
  canvas.height = 12;
  const context = canvas.getContext('2d');
  if (!context) return null;
  const image = context.createImageData(12, 12);
  for (let cell = 0; cell < 144; cell += 1) {
    image.data[cell * 4] = grid[cell * 3] ?? 0;
    image.data[cell * 4 + 1] = grid[cell * 3 + 1] ?? 0;
    image.data[cell * 4 + 2] = grid[cell * 3 + 2] ?? 0;
    image.data[cell * 4 + 3] = 255;
  }
  context.putImageData(image, 0, 0);
  return canvas;
}

/**
 * The size of the System picture. It is larger than a field's grid, so the line between the two
 * halves stays sharp when the browser scales the picture.
 */
const SPLIT_SIZE = 48;

/**
 * The System picture: the light field at the top left and the dark field at the bottom right,
 * each smoothed to the picture's size.
 */
function splitCanvas(): HTMLCanvasElement | null {
  const light = fieldCanvas(THEMES.light.field);
  const dark = fieldCanvas(THEMES.dark.field);
  const canvas = document.createElement('canvas');
  canvas.width = SPLIT_SIZE;
  canvas.height = SPLIT_SIZE;
  const context = canvas.getContext('2d');
  if (!light || !dark || !context) return null;
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(light, 0, 0, SPLIT_SIZE, SPLIT_SIZE);
  context.beginPath();
  context.moveTo(SPLIT_SIZE, 0);
  context.lineTo(SPLIT_SIZE, SPLIT_SIZE);
  context.lineTo(0, SPLIT_SIZE);
  context.closePath();
  context.clip();
  context.drawImage(dark, 0, 0, SPLIT_SIZE, SPLIT_SIZE);
  return canvas;
}

/**
 * A picture of a choice as a PNG. A field's picture is its colour grid: the browser smooths it
 * when it scales it up, so a small swatch shows the field's soft gradient.
 */
function choiceThumb(choice: ThemeChoice): string {
  const kept = thumbs.get(choice);
  if (kept) return kept;
  const canvas = choice === 'system' ? splitCanvas() : fieldCanvas(THEMES[choice].field);
  if (!canvas) return '';
  const url = canvas.toDataURL();
  thumbs.set(choice, url);
  return url;
}

function Swatch({ choice, className }: { choice: ThemeChoice; className: string }) {
  const thumb = choiceThumb(choice);
  const base = grainFieldSource(THEMES[choice === 'system' ? 'light' : choice].field).base;
  return (
    <span
      className={className}
      style={{ backgroundColor: base, backgroundImage: thumb ? `url(${thumb})` : undefined }}
      aria-hidden="true"
    />
  );
}

export function ThemePicker() {
  const choice = useThemeChoice();
  const [open, setOpen] = useState(false);
  // The option that the keyboard or the pointer is on.
  const [active, setActive] = useState<ThemeChoice>(choice);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const baseId = useId();
  const listId = `${baseId}-list`;
  const optionId = (name: ThemeChoice) => `${baseId}-${name}`;

  // Opening puts the keyboard in the list, on the chosen theme.
  useEffect(() => {
    if (!open) return;
    setActive(choice);
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
  const move = (to: ThemeChoice | undefined) => {
    if (!to) return;
    setActive(to);
    setTheme(to);
  };

  const onListKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = THEME_CHOICES.indexOf(active);
    const last = THEME_CHOICES.length - 1;
    switch (event.key) {
      case 'ArrowDown':
        move(THEME_CHOICES[Math.min(last, index + 1)]);
        break;
      case 'ArrowUp':
        move(THEME_CHOICES[Math.max(0, index - 1)]);
        break;
      case 'Home':
        move(THEME_CHOICES[0]);
        break;
      case 'End':
        move(THEME_CHOICES[last]);
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
        aria-label={`Theme: ${choiceLabel(choice)}`}
        title={choiceLabel(choice)}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={onButtonKey}
      >
        <Swatch choice={choice} className="ss-field-swatch" />
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
            {THEME_CHOICES.map((name) => (
              <div
                key={name}
                id={optionId(name)}
                role="option"
                aria-selected={name === choice}
                className={`ss-field-option ${name === active ? 'ss-field-option-active' : ''}`}
                onPointerEnter={() => setActive(name)}
                onClick={() => {
                  setTheme(name);
                  close(true);
                }}
              >
                <Swatch choice={name} className="ss-field-thumb" />
                <span className="ss-field-option-name">{choiceLabel(name)}</span>
                {name === choice && <IconCheck className="ss-field-check" size={15} stroke={2.4} aria-hidden="true" />}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
