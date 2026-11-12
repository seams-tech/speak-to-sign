// What the command listener may hear while other parts of the page are open.
//
// - An open dialog holds it as `dialog`: the bar then hears only "close" (closeRequest), which
//   closes the newest dialog. The rest of what the visitor says to a dialog is not a command.
// - A recording holds it as `recording`: the Seams Wallet's voice card, or the page's own bet
//   recorder, records the sentence that signs. The bar then does not listen at all, so it takes
//   no words of that sentence and does not compete for the microphone. A voice card in the
//   page's dialog holds it only while it can record (WalletDialog): on its result, "close" ends
//   the card and the dialog.

import { useEffect, useSyncExternalStore } from 'react';

export type HoldKind = 'dialog' | 'recording';

/** The bar's state: free, a dialog is open, or a recording runs (the strongest hold wins). */
export type VoiceHold = HoldKind | null;

const holds: Record<HoldKind, number> = { dialog: 0, recording: 0 };
const listeners = new Set<() => void>();

/** Holds the command listener until the result is called. */
export function holdVoice(kind: HoldKind): () => void {
  holds[kind] += 1;
  listeners.forEach((listener) => listener());
  let released = false;
  return () => {
    if (released) return;
    released = true;
    holds[kind] -= 1;
    listeners.forEach((listener) => listener());
  };
}

/** Holds the command listener while the component is mounted, and `kind` is not null. */
export function useHoldVoice(kind: HoldKind | null): void {
  useEffect(() => (kind === null ? undefined : holdVoice(kind)), [kind]);
}

function current(): VoiceHold {
  return holds.recording > 0 ? 'recording' : holds.dialog > 0 ? 'dialog' : null;
}

/** The strongest hold on the command listener now. */
export function useVoiceHold(): VoiceHold {
  return useSyncExternalStore((listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }, current);
}

// "Close", "close this post", "cancel", "never mind": a short sentence that only asks to close.
// A speech-to-text model can write "close" as "clothes".
const CLOSE = /^(?:(?:ok|okay|please|now|just)\s+)*(?:close|clothes|cancel|dismiss|exit|quit|never\s*mind)\b(?:\s+[a-z']+){0,3}$/;

/** True when a sentence only asks to close the dialog. */
export function closeRequest(text: string): boolean {
  return CLOSE.test(
    text
      .toLowerCase()
      .replace(/[^a-z'\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
  );
}

/**
 * Closes the newest open dialog, as the Escape key does. False when it stays: a locked dialog,
 * for example while the Wallet works.
 */
export function closeNewestDialog(): boolean {
  return !document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
}
