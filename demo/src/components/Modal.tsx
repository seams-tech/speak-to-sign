import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

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
    const opener = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !lockedRef.current) onCloseRef.current();
      if (event.key === 'Tab') keepFocusInside(event, dialogRef.current);
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
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
