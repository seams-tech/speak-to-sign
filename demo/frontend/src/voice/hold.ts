// What the command listener may hear while other parts of the page are open.
//
// - An open dialog holds it as `dialog`: the bar then hears only "close" (closeRequest), which
//   closes the newest dialog, "view transaction" (viewTransactionRequest) and "view TDX
//   quote" (viewQuoteRequest), when the Wallet's card shows the result of a transaction, and
//   "try again" (retryRequest), when the Wallet's card or the dialog shows a failed try. The
//   rest of what the visitor says to a dialog is not a command.
// - A recording holds it as `recording`: the Seams Wallet's voice card, or the page's own bet
//   recorder, records the sentence that signs. The bar then does not listen at all, so it takes
//   no words of that sentence and does not compete for the microphone. A voice card in the
//   page's dialog holds it only while it can record (WalletDialog): on its result, "close" ends
//   the card and the dialog.

import { useEffect, useSyncExternalStore } from 'react';
import { plainWords, retryRequest, viewTransactionRequest } from './command.ts';

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

/** What the Wallet card in the open dialog shows with its result: the two links of the card. */
export interface ShownResult {
  /** The hash of the transaction, for "view transaction". */
  transaction: string;
  /** The OutLayer record of the verifier call, for "view TDX quote". Null when the Wallet gave none. */
  quoteUrl: string | null;
}

let shownResult: ShownResult | null = null;

/**
 * Sets what "view transaction" and "view TDX quote" open: the result of the Wallet request when
 * the Wallet's card shows the result of a transaction, and null when that card goes. The card is
 * in the Wallet's frame, so the page cannot press its links; it opens the same pages itself.
 */
export function showResult(result: unknown): void {
  const transaction = transactionHashOf(result);
  const next = transaction === null ? null : { transaction, quoteUrl: quoteUrlOf(result) };
  if (next?.transaction === shownResult?.transaction && next?.quoteUrl === shownResult?.quoteUrl) return;
  shownResult = next;
  listeners.forEach((listener) => listener());
}

/** The result that the Wallet card in the open dialog shows now, or null. */
export function useShownResult(): ShownResult | null {
  return useSyncExternalStore((listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }, () => shownResult);
}

/** The transaction hash in the result of a Wallet request, in each form that the signers get. */
export function transactionHashOf(result: unknown): string | null {
  const fields = (value: unknown) => (typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {});
  const outer = fields(result);
  const inner = fields(outer.result);
  const hash = inner.transactionHash ?? outer.transactionHash ?? outer.transactionId;
  return typeof hash === 'string' && hash !== '' ? hash : null;
}

/**
 * The OutLayer record of the verifier call in the result of a Wallet request (`attestationUrl`,
 * from Seams Wallet 0.70.4), with its TDX quote. Null when the result has none.
 */
export function quoteUrlOf(result: unknown): string | null {
  const url = typeof result === 'object' && result !== null ? (result as Record<string, unknown>).attestationUrl : null;
  return typeof url === 'string' && url.startsWith('https://') ? url : null;
}

// "View TDX quote", "open the quote", "show me the attestation". A speech-to-text model can
// write "TDX" as "T D X", and "quote" as "quotes".
const VIEW_QUOTE = /^(?:(?:ok|okay|please|now|just|and)\s+)*(?:view|open|show|see|click|press|go to)\b(?:\s+[a-z']+){0,5}\s+(?:quotes?|attestation)\b(?:\s+[a-z']+){0,3}$/;

/** True when a sentence only asks to see the TDX quote of the verifier call. */
export function viewQuoteRequest(text: string): boolean {
  return VIEW_QUOTE.test(plainWords(text));
}

export { retryRequest, viewTransactionRequest };

let cardRetry: (() => void) | null = null;

/**
 * Sets what "try again" does while the Wallet's card shows a failed check ("The words did not
 * match"), and null when that card goes. The card is in the Wallet's frame, so the page cannot
 * press its "Try again": the host of the card sends the request again, with a new card.
 */
export function offerRetry(retry: (() => void) | null): void {
  if (retry === cardRetry) return;
  cardRetry = retry;
  listeners.forEach((listener) => listener());
}

/** True while the Wallet's card shows a failed check that "try again" can send again. */
export function useRetryOffered(): boolean {
  return useSyncExternalStore((listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }, () => cardRetry !== null);
}

/**
 * Does "Try again". The Wallet's card is above the dialog, so its retry comes first. Without
 * one, it presses "Try again" in the newest open dialog that has it, as a click does. False
 * when nothing can try again.
 */
export function pressTryAgain(): boolean {
  if (cardRetry) {
    cardRetry();
    return true;
  }
  const buttons = [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')];
  const button = buttons.reverse().find((candidate) => !candidate.disabled && candidate.textContent?.trim().toLowerCase() === 'try again');
  button?.click();
  return button !== undefined;
}

/**
 * Opens a page in a new tab. False when the browser stopped it: a new tab from spoken words has
 * no click behind it, so a browser that does not allow pop-ups for the site stops it.
 */
export function openInNewTab(url: string): boolean {
  const tab = window.open(url, '_blank');
  if (tab) tab.opener = null;
  return tab !== null;
}

export const NEW_TAB_STOPPED = 'The browser stopped the new tab. Allow pop-ups for this site.';

// "Close", "close this post", "cancel", "never mind", "done": a short sentence that only asks to close.
// A speech-to-text model can write "close" as "clothes".
const CLOSE = /^(?:(?:ok|okay|please|now|just)\s+)*(?:close|clothes|cancel|dismiss|exit|quit|done|never\s*mind)\b(?:\s+[a-z']+){0,3}$/;

/** True when a sentence only asks to close the dialog. */
export function closeRequest(text: string): boolean {
  return CLOSE.test(plainWords(text));
}

/**
 * Closes the newest open dialog, as the Escape key does. False when it stays: a locked dialog,
 * for example while the Wallet works.
 */
export function closeNewestDialog(): boolean {
  return !document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
}
