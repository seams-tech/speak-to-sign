// What a step of a dialog knows of the Wallet card that shows over it. The card is an iframe of
// the Wallet, above the page: the SDK fades it in and out, and reports each change with the
// step events. The step uses them so that the dialog and the card never show through each other.

import { useCallback, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import type { WalletStepEvents, WalletStepSize } from '@seams/wallet/react';

/**
 * The longest wait for the card's exit event. The SDK fades the card out in 150 ms, then sends
 * the event. Without the event, the step goes on after this time.
 */
const GONE_LIMIT_MS = 400;

export interface WalletCard {
  /** The card's size, from the moment it has one. It stays after the card is gone. */
  size: WalletStepSize | null;
  /** The card is on the screen: from the moment it has a size until it is gone. */
  entered: boolean;
  /** The card is fully painted: it covers the dialog's own surface. */
  shown: boolean;
  /** The step events for the card's call or component. */
  events: WalletStepEvents;
  /** Runs `then` when the card is gone from the screen. With no card, it runs at once. */
  afterCard(then: () => void): void;
  /** The host ended the card and takes no more events of it: the card is gone now. */
  ended(): void;
}

export function useWalletCard(): WalletCard {
  const [size, setSize] = useState<WalletStepSize | null>(null);
  const [shown, setShown] = useState(false);
  const [entered, setEntered] = useState(false);
  // The card has a size and has not left the screen.
  const live = useRef(false);
  const waiting = useRef<(() => void)[]>([]);
  const timer = useRef(0);

  const gone = useCallback(() => {
    live.current = false;
    window.clearTimeout(timer.current);
    setShown(false);
    setEntered(false);
    for (const then of waiting.current.splice(0)) then();
  }, []);

  const events = useMemo<WalletStepEvents>(
    () => ({
      // The SDK shows the card in the next frame, so the dialog takes the card's size now.
      onEnter: (next) => {
        live.current = true;
        flushSync(() => {
          setSize(next);
          setEntered(true);
        });
      },
      onResize: (next) => flushSync(() => setSize(next)),
      // The card's fade-in is over.
      onReady: () => setShown(true),
      onExit: gone,
    }),
    [gone],
  );

  const afterCard = useCallback(
    (then: () => void) => {
      if (!live.current) {
        then();
        return;
      }
      waiting.current.push(then);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(gone, GONE_LIMIT_MS);
    },
    [gone],
  );

  return { size, entered, shown, events, afterCard, ended: gone };
}
