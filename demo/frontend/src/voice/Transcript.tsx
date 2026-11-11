// The words of the voice bar on one line, as a ticker. The newest words are at the right end and
// bright. The sentences before them are grey, and greyer with age. When the line is full, new
// words push the older words to the left, where they fade out at the edge and go.

import { useLayoutEffect, useRef } from 'react';

/** One finished sentence of the line. */
export interface SaidSentence {
  id: number;
  text: string;
}

/** The line keeps this many finished sentences. Older ones are out of view in any case. */
export const MAX_SAID = 8;

/** How long the line takes to slide when new words come. */
const SLIDE_MS = 220;

export function Transcript({ said, live, caret, hint }: { said: SaidSentence[]; live: string | null; caret: boolean; hint: string }) {
  const box = useRef<HTMLParagraphElement>(null);
  const line = useRef<HTMLSpanElement>(null);
  const lastWidth = useRef(0);
  const words = [...said.map((sentence) => sentence.text), live ?? ''].join(' ');

  // The line is right-aligned only when it is wider than the bar, so a short sentence starts at
  // the left. New words then slide the line from where it was (a FLIP animation).
  useLayoutEffect(() => {
    const container = box.current;
    const element = line.current;
    if (!container || !element) {
      lastWidth.current = 0;
      if (container) container.dataset.full = 'false';
      return;
    }
    const room = container.clientWidth;
    const width = element.scrollWidth;
    const leftOf = (lineWidth: number) => (lineWidth > room ? room - lineWidth : 0);
    const from = leftOf(lastWidth.current) - leftOf(width);
    lastWidth.current = width;
    container.dataset.full = String(width > room);
    if (from <= 0 || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    // A slide that is still running goes on from where it is now.
    const running = new DOMMatrixReadOnly(getComputedStyle(element).transform).m41;
    for (const animation of element.getAnimations()) animation.cancel();
    element.animate([{ transform: `translateX(${from + running}px)` }, { transform: 'translateX(0)' }], { duration: SLIDE_MS, easing: 'ease-out' });
  }, [words]);

  const empty = said.length === 0 && !live;
  // The newest sentence: the one that the visitor says now, or else the last one.
  const ageOf = (index: number) => said.length - 1 - index + (live ? 1 : 0);
  return (
    <p className="voice-words" ref={box} aria-live="off">
      {empty ? (
        <span className="voice-hint">{hint}</span>
      ) : (
        <span className="voice-line" ref={line}>
          {said.map((sentence, index) => (
            <span key={sentence.id} className={`voice-said voice-age-${Math.min(ageOf(index), 2)}`}>
              {sentence.text}{' '}
            </span>
          ))}
          {live && <span className="voice-said voice-age-0">{live}</span>}
          {caret && <span className="voice-caret" aria-hidden="true" />}
        </span>
      )}
    </p>
  );
}
