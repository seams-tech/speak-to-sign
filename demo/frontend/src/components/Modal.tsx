import { createContext, useCallback, useContext, useEffect, useImperativeHandle, useRef, useState, type ReactNode, type Ref, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { useHoldVoice } from '../voice/hold';

/** How long the close fade runs (the CSS `.overlay-leaving`). */
const EXIT_MS = 140;
/** How long the dialog takes to change size when its content changes. */
const RESIZE_MS = 280;
const RESIZE_EASING = 'cubic-bezier(0.2, 0.8, 0.2, 1)';

/** Closes the dialog with its close animation, then calls `after` (default: `onClose`). */
export interface ModalHandle {
  close(after?: () => void): void;
}

/** The panel of the dialog that a step is in. */
const DialogPanel = createContext<RefObject<HTMLDivElement | null> | null>(null);

/**
 * Reads the height of the dialog now, in CSS pixels (0 outside a dialog). A step that gets its
 * size late (a Wallet card) holds this height first, so the dialog changes its size only once.
 */
export function useDialogHeight(): () => number {
  const panel = useContext(DialogPanel);
  return useCallback(() => panel?.current?.offsetHeight ?? 0, [panel]);
}

/** Open dialogs, newest last. Only the newest one answers Escape and Tab. */
const openDialogs: object[] = [];

/**
 * The open modals that hold the page's scroll. Separate from `openDialogs`: the page's app
 * window is in that stack for Escape, but it does not lock the body, so a closed modal must not
 * wait for the window before it gives the scroll back.
 */
let scrollLocks = 0;
let bodyOverflow = '';

/**
 * An X-style dialog over a grey overlay. Escape and a click outside close it unless `locked`.
 * A `bare` dialog has no panel of its own, for content that brings its own card.
 *
 * It fades and grows in when it opens. Escape, a click outside and `handle.close()` fade it out
 * first; a parent that removes it at once skips that. With reduced motion it only fades.
 */
export function Modal({
  labelledBy,
  onClose,
  locked,
  bare = false,
  handle,
  onOutside,
  children,
}: {
  labelledBy: string;
  onClose: () => void;
  locked: boolean;
  bare?: boolean;
  handle?: Ref<ModalHandle>;
  /** For Escape and a click outside, in place of closing: for example, back to the step before. */
  onOutside?: () => void;
  children: ReactNode;
}) {
  // The words that the visitor says to a dialog (a sentence that signs) are not a command.
  useHoldVoice();
  const dialogRef = useRef<HTMLDivElement>(null);
  const lockedRef = useRef(locked);
  const onCloseRef = useRef(onClose);
  const onOutsideRef = useRef(onOutside);
  useEffect(() => {
    lockedRef.current = locked;
    onCloseRef.current = onClose;
    onOutsideRef.current = onOutside;
  });

  const [leaving, setLeaving] = useState(false);
  const leaveTimer = useRef(0);
  const close = useCallback((after?: () => void) => {
    const done = after ?? (() => onCloseRef.current());
    if (leaveTimer.current) return;
    setLeaving(true);
    leaveTimer.current = window.setTimeout(done, EXIT_MS);
  }, []);
  useImperativeHandle(handle, () => ({ close }), [close]);
  useEffect(() => () => window.clearTimeout(leaveTimer.current), []);
  useSmoothSize(dialogRef, !bare);

  useEffect(() => {
    const token = {};
    openDialogs.push(token);
    const opener = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    if (scrollLocks === 0) bodyOverflow = document.body.style.overflow;
    scrollLocks += 1;
    document.body.style.overflow = 'hidden';
    const onKey = (event: KeyboardEvent) => {
      if (openDialogs[openDialogs.length - 1] !== token) return;
      if (event.key === 'Escape' && !lockedRef.current) (onOutsideRef.current ?? close)();
      if (event.key === 'Tab') keepFocusInside(event, dialogRef.current);
    };
    document.addEventListener('keydown', onKey);
    return () => {
      openDialogs.splice(openDialogs.indexOf(token), 1);
      document.removeEventListener('keydown', onKey);
      scrollLocks -= 1;
      if (scrollLocks === 0) document.body.style.overflow = bodyOverflow;
      opener?.focus();
    };
  }, [close]);

  const closeOutside = () => {
    if (!lockedRef.current) (onOutsideRef.current ?? close)();
  };
  const dialog = (
    <div
      ref={dialogRef}
      className={bare ? 'dialog dialog-bare' : 'dialog'}
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelledBy}
      tabIndex={-1}
    >
      <DialogPanel value={dialogRef}>{children}</DialogPanel>
    </div>
  );

  // A bare dialog's card can be the Seams Wallet iframe, which the SDK paints between the grey
  // backdrop and the dialog. So the dialog's own controls can sit on top of the card.
  return createPortal(
    bare ? (
      <>
        <div className={`overlay-backdrop ${leaving ? 'overlay-leaving' : ''}`} onMouseDown={closeOutside} />
        <div className="overlay overlay-bare">{dialog}</div>
      </>
    ) : (
      <div
        className={`overlay ${leaving ? 'overlay-leaving' : ''}`}
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) closeOutside();
        }}
      >
        {dialog}
      </div>
    ),
    document.body,
  );
}

type Size = { width: number; height: number };

function sameSize(a: Size, b: Size): boolean {
  return Math.abs(a.width - b.width) < 1 && Math.abs(a.height - b.height) < 1;
}

/**
 * When the content of the dialog changes its size (a new step, an error line, a market that
 * loads), the dialog grows or shrinks to the new size in place of a jump.
 *
 * A ResizeObserver reports the new size after layout and before paint, so the animation starts
 * from the old size in the same frame. While the dialog animates, its own size is the
 * animation's, so the observer also watches the dialog's children. A change in their size during
 * the animation turns the same move toward the new size: a step whose parts arrive one after
 * another (the sign-in step's width, then the Wallet card's height) moves once, not twice.
 */
function useSmoothSize(ref: RefObject<HTMLDivElement | null>, enabled: boolean) {
  useEffect(() => {
    const panel = ref.current;
    if (!enabled || !panel || typeof ResizeObserver !== 'function') return;
    // The content's size: the size that the dialog shows, or the size that it moves to.
    let size: Size | null = null;
    let running: Animation | null = null;

    // Layout sizes: the open animation's scale does not count.
    const layoutSize = (): Size => ({ width: panel.offsetWidth, height: panel.offsetHeight });

    const start = (from: Size, to: Size) => {
      panel.style.overflow = 'hidden';
      // The limits go while it runs: a new step can bring a new max-width (the sign-in step).
      const animation = panel.animate(
        [
          { width: `${from.width}px`, height: `${from.height}px`, maxWidth: 'none', maxHeight: 'none' },
          { width: `${to.width}px`, height: `${to.height}px`, maxWidth: 'none', maxHeight: 'none' },
        ],
        { duration: RESIZE_MS, easing: RESIZE_EASING },
      );
      animation.onfinish = () => {
        running = null;
        panel.style.overflow = '';
        check();
      };
      running = animation;
    };

    const stop = () => {
      if (!running) return;
      running.onfinish = null;
      running.cancel();
      running = null;
      panel.style.overflow = '';
    };

    // While the dialog moves, its size is the animation's. With the animation's effect off the
    // dialog for one measurement, layout gives the content's own size; the timing goes on as is.
    const contentSize = (animation: Animation): Size => {
      const effect = animation.effect as KeyframeEffect;
      effect.target = null;
      panel.style.overflow = '';
      const content = layoutSize();
      panel.style.overflow = 'hidden';
      effect.target = panel;
      return content;
    };

    const check = () => {
      const moving = running;
      const next = moving ? contentSize(moving) : layoutSize();
      const from = size;
      size = next;
      if (!from || sameSize(from, next)) return;
      // A new size during a move: the move turns toward it from the frame that shows now.
      const shown = moving ? layoutSize() : from;
      stop();
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      start(shown, next);
    };

    const observer = new ResizeObserver(check);
    const children = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.removedNodes) if (node instanceof Element) observer.unobserve(node);
        for (const node of record.addedNodes) if (node instanceof Element) observer.observe(node);
      }
    });
    observer.observe(panel);
    for (const child of panel.children) observer.observe(child);
    children.observe(panel, { childList: true });
    return () => {
      children.disconnect();
      observer.disconnect();
      stop();
    };
  }, [ref, enabled]);
}

/**
 * Makes `onEscape` answer Escape while this layer is the newest open dialog. The Speak-to-Sign
 * page uses it for its app window, so Escape closes a notes dialog first, then the window.
 */
export function useEscapeLayer(onEscape: () => void) {
  const onEscapeRef = useRef(onEscape);
  useEffect(() => {
    onEscapeRef.current = onEscape;
  });
  useEffect(() => {
    const token = {};
    openDialogs.push(token);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && openDialogs[openDialogs.length - 1] === token) onEscapeRef.current();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      openDialogs.splice(openDialogs.indexOf(token), 1);
      document.removeEventListener('keydown', onKey);
    };
  }, []);
}

function keepFocusInside(event: KeyboardEvent, root: HTMLElement | null) {
  if (!root) return;
  const items = Array.from(
    root.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), select:not([disabled])'),
  );
  const first = items[0];
  const last = items[items.length - 1];
  if (!first || !last) return;
  if (event.shiftKey && (document.activeElement === first || document.activeElement === root)) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}
