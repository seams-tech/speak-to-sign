// One dialog for one flow. The Wallet's cards are steps of the same dialog, in place of a second
// dialog on top: the sign-in, and the voice card of a Speak-to-Sign request. The dialog changes
// into the card, then back to its own step, which stays mounted (hidden) and keeps its state.
//
// A Wallet card is an iframe above the page, which the SDK fades in and out over an element of
// the dialog (the anchor). The dialog shows one surface at each moment:
// - Its own surface is opaque until the card is fully painted, so the page never shows through
//   the two of them. It is opaque again in the frame in which the card starts to leave.
// - It has the card's size before the card shows: it moves to the card's size from the moment
//   the card has one (`pinned`), and the card waits for that move (`enterDelayMs`).
// - Its own step returns when the card is gone.
//
// The voice card has Minimize. While the card is minimized, the dialog is out of sight too (it
// keeps its place, so the card's anchor does not move), and a pill on the page shows the card's
// progress. A click on the pill, or the card's result, brings both back.

import { createContext, useContext, useEffect, useId, useRef, useState, type ReactNode, type Ref } from 'react';
import { WalletStep, type WalletStepProgress } from '@seams/wallet/react';
import { DemoContext } from '../demoContext';
import { hostVoiceCard, type VoiceCard } from '../signer/voiceCard';
import { showResult, useHoldVoice } from '../voice/hold';
import { CardPill } from './CardPill';
import { Modal, RESIZE_MS, useDialogHeight, type ModalHandle } from './Modal';
import { Morph, MorphView } from './Morph';
import { SignInStep } from './SignInModal';
import { useWalletCard } from './useWalletCard';

/**
 * True while a request waits for its Wallet card: the Wallet makes the card (for a note, the
 * Seams server writes the summary first, in 1 to 3 s). The dialog keeps its own step on the
 * screen for that time, and the step's voice button says that the card comes. Outside a
 * WalletDialog it is false.
 */
export const CardWaitContext = createContext(false);

export function WalletDialog({
  titleId,
  onClose,
  locked,
  handle,
  children,
}: {
  /** The id of the title of the dialog's own step. */
  titleId: string;
  onClose: () => void;
  /** True while the dialog's own step must stay: Escape and a click outside do nothing. */
  locked: boolean;
  handle?: Ref<ModalHandle>;
  /** The dialog's own step: head, body and foot. */
  children: ReactNode;
}) {
  const { signingIn, end } = useHostedSignIn();
  const signInCard = useWalletCard();
  const call = useVoiceCardHost();
  const voiceCard = useWalletCard();
  // The voice card has Back and Close. Back ends the card and the dialog's own step returns.
  // Close ends the card, then the whole dialog when the card is gone.
  const closeAfterCard = useRef(false);
  // The minimized card: the Wallet's function that shows it again, and its stage.
  const [minimized, setMinimized] = useState<{ restore: () => void } | null>(null);
  const [progress, setProgress] = useState<WalletStepProgress | null>(null);
  const stepTitleId = useId();
  // The dialog changes to the card's step when the card has a size, not when the request starts:
  // an empty step for the seconds before the card looked like a blank dialog.
  // After that it keeps the card's step until the request ends, as before (also while the card is
  // minimized, or for the moment between the card's exit and the request's end).
  const cardSeen = useRef<number | null>(null);
  if (call && voiceCard.entered) cardSeen.current = call.id;
  const cardUp = call !== null && cardSeen.current === call.id;
  const view = signingIn ? 'signin' : cardUp ? 'voice' : 'main';
  // The voice bar stays off while the card can record: from its start until it checks or shows
  // its result. Its result ("Note posted", "The words did not match") can close by voice or
  // Escape: the dialog closes, and the card ends with it.
  const stage = call ? (progress?.stage ?? 'recording') : null;
  useHoldVoice(stage === 'recording' ? 'recording' : null);
  // A dialog that closes on the card's result takes its transaction with it.
  useEffect(() => () => showResult(null), []);
  const cardResult = stage === 'result';

  // The sign-in ends (signed in, Back, Escape): its menu goes, and with it a card that still
  // shows. The dialog's own step returns when the card is gone.
  const [signInEnded, setSignInEnded] = useState(false);
  const leaveSignIn = (signedIn: boolean) => {
    if (signInEnded) return;
    setSignInEnded(true);
    signInCard.afterCard(() => {
      setSignInEnded(false);
      end(signedIn);
    });
  };

  const voiceHeight = voiceCard.size?.height;
  useEffect(() => {
    if (voiceHeight) lastVoiceCardHeight = voiceHeight;
  }, [voiceHeight]);

  return (
    <Modal
      labelledBy={view === 'main' ? titleId : stepTitleId}
      onClose={onClose}
      // The voice card ends with its own Back or Close, or on its result with Escape. The sign-in
      // goes back with Escape.
      locked={(locked || call !== null) && !signingIn && !cardResult}
      handle={handle}
      onOutside={signingIn ? () => leaveSignIn(false) : undefined}
      pinned={cardUp ? voiceCard.size : null}
      minimized={minimized !== null}
    >
      <Morph view={view} flex>
        <MorphView name="main" keep>
          <CardWaitContext.Provider value={call !== null && !cardUp}>{children}</CardWaitContext.Provider>
        </MorphView>
        {signingIn && (
          <MorphView name="signin" bare>
            <SignInStep titleId={stepTitleId} card={signInCard} ended={signInEnded} onLeave={leaveSignIn} />
          </MorphView>
        )}
        {cardUp && (
          <MorphView name="voice" bare>
            <VoiceCardStep titleId={stepTitleId} height={voiceHeight} shown={voiceCard.shown} />
          </MorphView>
        )}
      </Morph>
      {call && (
        <div className="card-layer">
          <WalletStep
            key={call.id}
            surface={{
              kind: 'speak_to_sign',
              // The request's own caller handles its result and its error.
              send: (card) =>
                call
                  .send(card)
                  // The card now shows its result: "view transaction" and "view TDX quote" open its links.
                  .then((result) => showResult(result))
                  .catch(() => undefined)
                  .finally(() =>
                    voiceCard.afterCard(() => {
                      showResult(null);
                      // A card that ends while it is minimized (an error) brings the dialog back.
                      setMinimized(null);
                      setProgress(null);
                      call.end();
                      if (closeAfterCard.current) {
                        closeAfterCard.current = false;
                        onClose();
                      }
                    }),
                  ),
            }}
            chrome="back_and_close"
            minimize
            transition={VOICE_CARD_TRANSITION}
            {...voiceCard.events}
            onClose={() => {
              closeAfterCard.current = true;
            }}
            onMinimize={(restore) => setMinimized({ restore })}
            onRestore={() => setMinimized(null)}
            onProgress={setProgress}
          />
        </div>
      )}
      {/* Close ends the card with its dialog: the step unmounts, as when the card's own Close ends it. */}
      {call && minimized && <CardPill progress={progress} onOpen={minimized.restore} onClose={onClose} />}
    </Modal>
  );
}

/**
 * The voice card's times. The dialog moves to the card's size when the card has one (`onEnter`),
 * and the card fades in only when that move is over. So the card never shows over a dialog
 * that is still larger than the card.
 */
const VOICE_CARD_TRANSITION = { enterDelayMs: RESIZE_MS, fadeInMs: 120, fadeOutMs: 120 } as const;

/** The page's hosted sign-in, when the page has one (the market preview has none). */
function useHostedSignIn(): { signingIn: boolean; end: (signedIn: boolean) => void } {
  const demo = useContext(DemoContext);
  const host = demo?.hostSignIn;
  useEffect(() => (host ? host() : undefined), [host]);
  return { signingIn: demo?.signingIn ?? false, end: (signedIn) => demo?.endSignIn(signedIn) };
}

/** One request whose voice card the dialog shows now. */
interface CardCall {
  id: number;
  /** Sends the request with the card's place. The request's caller gets the same result. */
  send: (card: VoiceCard) => Promise<unknown>;
  /** The card is gone: the dialog returns to its own step. */
  end: () => void;
}

let nextCallId = 1;

/**
 * Makes this dialog the host of the voice card while it is open. The result is the request that
 * waits for its card, if any: the dialog sends it at once, and shows VoiceCardStep.
 */
function useVoiceCardHost(): CardCall | null {
  const [call, setCall] = useState<CardCall | null>(null);
  useEffect(() => {
    // The request that the dialog has not sent yet. If the dialog closes first, it ends.
    let unsent: ((cause: Error) => void) | null = null;
    const unhost = hostVoiceCard({
      show: (send) =>
        new Promise((resolve, reject) => {
          const id = nextCallId++;
          unsent = reject;
          setCall({
            id,
            send: async (card) => {
              unsent = null;
              try {
                const result = await send(card);
                resolve(result);
                return result;
              } catch (cause) {
                reject(cause);
                throw cause;
              }
            },
            end: () => setCall((current) => (current?.id === id ? null : current)),
          });
        }),
    });
    return () => {
      unhost();
      unsent?.(new Error('The dialog closed before the voice card opened.'));
    };
  }, []);
  return call;
}

/** The height of the last voice card, as the first height of the next one. */
let lastVoiceCardHeight: number | null = null;

/**
 * The step under the Wallet's voice card: an empty surface with the card's size. The card's
 * anchor is not in the step. It is in a layer over the dialog (.card-layer), from the moment the
 * request arrives: the Wallet makes the card while the step before this one fades out.
 *
 * Until the card has its size, the step has the height of the last card, so the dialog is at the
 * card's size when the card shows. For the first card, that is the height of the step before it.
 */
function VoiceCardStep({ titleId, height, shown }: { titleId: string; height: number | undefined; shown: boolean }) {
  const dialogHeight = useDialogHeight();
  const [firstHeight] = useState(() => lastVoiceCardHeight ?? dialogHeight());
  return (
    <>
      <h2 id={titleId} className="sr-only">
        Say the sentence in the Seams Wallet card
      </h2>
      <div className="wallet-step" data-card-shown={shown || undefined} style={{ height: height ?? firstHeight }} />
    </>
  );
}
