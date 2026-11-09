// The big window: an example grows from its small screen to about 90% of the screen, and the
// app in it works. Escape, the close button or a click outside shrink it back.

import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useEscapeLayer } from '../components/Modal';
import type { ExampleId } from './examples';
import { BrowserChrome, DrawnFrame, useReducedMotion } from './frame';

/** The small screen of an example's row: where the window grows from and shrinks to. */
export function exampleScreen(id: ExampleId): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-example-screen="${id}"]`);
}

export function ExampleWindow({
  id,
  title,
  tag,
  tone,
  url,
  closing,
  onClose,
  onExited,
  children,
}: {
  id: ExampleId;
  title: string;
  tag: string;
  tone: 'example' | 'live';
  url: string;
  /** True while the window shrinks back. */
  closing: boolean;
  onClose: () => void;
  /** Called when the window has shrunk back. */
  onExited: () => void;
  children: ReactNode;
}) {
  const windowRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const still = useReducedMotion();
  const exitedRef = useRef(onExited);
  useEffect(() => {
    exitedRef.current = onExited;
  });
  useEscapeLayer(onClose);

  // The page behind does not scroll while the window is open.
  useEffect(() => {
    const html = document.documentElement;
    const { overflow } = html.style;
    html.style.overflow = 'hidden';
    windowRef.current?.focus({ preventScroll: true });
    return () => {
      html.style.overflow = overflow;
    };
  }, []);

  // Grow from the small screen.
  useLayoutEffect(() => {
    const element = windowRef.current;
    if (!element) return;
    const fade = backdropRef.current?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: still ? 120 : 260, easing: 'ease-out' });
    const grow = element.animate(growFrames(element, exampleScreen(id), still), {
      duration: still ? 120 : 380,
      easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
    });
    return () => {
      fade?.cancel();
      grow.cancel();
    };
  }, [id, still]);

  // Shrink back to the small screen, then tell the page.
  useLayoutEffect(() => {
    if (!closing) return;
    const element = windowRef.current;
    if (!element) {
      exitedRef.current();
      return;
    }
    // If the hash comes back before the end (the Forward button), the window stays open.
    let current = true;
    const duration = still ? 100 : 300;
    const fade = backdropRef.current?.animate([{ opacity: 1 }, { opacity: 0 }], { duration, easing: 'ease-in', fill: 'forwards' });
    const shrink = element.animate(growFrames(element, exampleScreen(id), still).reverse(), {
      duration,
      easing: 'cubic-bezier(0.4, 0, 0.7, 0.2)',
      fill: 'forwards',
    });
    shrink.finished.then(
      () => {
        if (current) exitedRef.current();
      },
      () => undefined,
    );
    return () => {
      current = false;
      fade?.cancel();
      shrink.cancel();
    };
  }, [closing, id, still]);

  return createPortal(
    <div className={`ss-window-root ${closing ? 'ss-window-closing' : ''}`}>
      <div className="ss-window-backdrop" ref={backdropRef} onClick={onClose} aria-hidden="true" />
      <div className="ss-window" data-example={id} ref={windowRef} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1}>
        <DrawnFrame tag={tag} tone={tone}>
          <BrowserChrome url={url} onClose={onClose}>
            <div className="ss-window-app">{children}</div>
          </BrowserChrome>
        </DrawnFrame>
      </div>
    </div>,
    document.body,
  );
}

/**
 * Keyframes from the small screen to the window (FLIP: the window is at its end place, and
 * starts as a transform that puts it over the small screen). A fade when the reader asks for
 * less motion, or when the small screen is off the screen.
 */
function growFrames(element: HTMLElement, from: HTMLElement | null, still: boolean): Keyframe[] {
  // The layout box, without the transform of an animation that still runs. The window's parent
  // fills the screen, so these are screen coordinates.
  const end = { left: element.offsetLeft, top: element.offsetTop, width: element.offsetWidth, height: element.offsetHeight };
  const start = from?.getBoundingClientRect();
  if (still) return [{ opacity: 0 }, { opacity: 1 }];
  if (!start || start.width === 0 || start.bottom < 0 || start.top > window.innerHeight) {
    return [
      { opacity: 0, transform: 'scale(0.96)', transformOrigin: '50% 50%' },
      { opacity: 1, transform: 'none', transformOrigin: '50% 50%' },
    ];
  }
  const x = start.left - end.left;
  const y = start.top - end.top;
  const sx = start.width / end.width;
  const sy = start.height / end.height;
  return [
    { transform: `translate(${x}px, ${y}px) scale(${sx}, ${sy})`, transformOrigin: '0 0' },
    { transform: 'none', transformOrigin: '0 0' },
  ];
}
