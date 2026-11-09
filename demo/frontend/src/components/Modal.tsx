import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** Open dialogs, newest last. Only the newest one answers Escape and Tab. */
const openDialogs: object[] = [];

/**
 * The open modals that hold the page's scroll. Separate from `openDialogs`: the page's app
 * window is in that stack for Escape, but it does not lock the body, so a closed modal must not
 * wait for the window before it gives the scroll back.
 */
let scrollLocks = 0;
let bodyOverflow = '';

/** An X-style dialog over a grey overlay. Escape and a click outside close it unless `locked`. */
export function Modal({
  labelledBy,
  onClose,
  locked,
  children,
}: {
  labelledBy: string;
  onClose: () => void;
  locked: boolean;
  children: ReactNode;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const lockedRef = useRef(locked);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    lockedRef.current = locked;
    onCloseRef.current = onClose;
  });

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
      if (event.key === 'Escape' && !lockedRef.current) onCloseRef.current();
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
  }, []);

  return createPortal(
    <div
      className="overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !lockedRef.current) onCloseRef.current();
      }}
    >
      <div ref={dialogRef} className="dialog" role="dialog" aria-modal="true" aria-labelledby={labelledBy} tabIndex={-1}>
        {children}
      </div>
    </div>,
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
