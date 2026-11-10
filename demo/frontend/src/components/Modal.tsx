import { useCallback, useEffect, useImperativeHandle, useRef, useState, type ReactNode, type Ref } from 'react';
import { createPortal } from 'react-dom';

/** How long the close animation runs (the CSS `overlay-out` and `dialog-out`). */
const EXIT_MS = 140;

/** Closes the dialog with its close animation, then calls `after` (default: `onClose`). */
export interface ModalHandle {
  close(after?: () => void): void;
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
 * first; a parent that removes it at once skips that.
 */
export function Modal({
  labelledBy,
  onClose,
  locked,
  bare = false,
  handle,
  children,
}: {
  labelledBy: string;
  onClose: () => void;
  locked: boolean;
  bare?: boolean;
  handle?: Ref<ModalHandle>;
  children: ReactNode;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const lockedRef = useRef(locked);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    lockedRef.current = locked;
    onCloseRef.current = onClose;
  });

  const [leaving, setLeaving] = useState(false);
  const leaveTimer = useRef(0);
  const close = useCallback((after?: () => void) => {
    const done = after ?? (() => onCloseRef.current());
    if (leaveTimer.current) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return done();
    setLeaving(true);
    leaveTimer.current = window.setTimeout(done, EXIT_MS);
  }, []);
  useImperativeHandle(handle, () => ({ close }), [close]);
  useEffect(() => () => window.clearTimeout(leaveTimer.current), []);

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
      if (event.key === 'Escape' && !lockedRef.current) close();
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
    if (!lockedRef.current) close();
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
      {children}
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
