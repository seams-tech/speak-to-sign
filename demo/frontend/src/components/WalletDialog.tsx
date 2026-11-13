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
//
// "Try again" by voice: the card of a failed check ("The words did not match") has its own "Try
// again", but it is in the Wallet's frame, and the page cannot press it. So the dialog offers a
// retry of its own to the voice bar: it ends that card and sends the same request again, with a
// new card. The request's caller sees one request, and gets the result of the newest try.

import { createContext, useContext, useEffect, useId, useRef, useState, type ReactNode, type Ref } from 'react';
import { WalletStep, type WalletStepProgress } from '@seams/wallet/react';
import { DemoContext } from '../demoContext';
import { cardTries, hostVoiceCard, type CardTry, type VoiceCard } from '../signer/voiceCard';
import { offerRetry, showResult, useHoldVoice } from '../voice/hold';
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
  // A new try of the request has a new card, so the dialog's own step shows again until then.
  const attempt = call?.attempt ?? null;
  const cardSeen = useRef<CardTry<unknown> | null>(null);
  if (attempt && voiceCard.entered) cardSeen.current = attempt;
  const cardUp = attempt !== null && cardSeen.current === attempt;
  const view = signingIn ? 'signin' : cardUp ? 'voice' : 'main';
  // The voice bar stays off while the card can record: from its start until it checks or shows
  // its result. Its result ("Note posted", "The words did not match") can close by voice or
  // Escape: the dialog closes, and the card ends with it.
  const stage = call ? (progress?.stage ?? 'recording') : null;
  useHoldVoice(stage === 'recording' ? 'recording' : null);
  // A dialog that closes on the card's result takes its transaction with it.
  useEffect(() => () => showResult(null), []);
  const cardResult = stage === 'result';
  // The try whose request has its result or its error. Until then the request waits in the card.
  const [settled, setSettled] = useState<CardTry<unknown> | null>(null);
  // The card shows a result, and the request still waits: the check failed, and the card has
  // "Try again". The voice bar's "try again" then starts a new try.
  const failed = call !== null && cardResult && settled !== attempt;
  const { ended: cardEnded } = voiceCard;
  useEffect(() => {
    if (!failed || !call) return undefined;
    // The stage of a signed request can come a moment before its result.
    const timer = window.setTimeout(
      () =>
        offerRetry(() => {
          offerRetry(null);
          showResult(null);
          closeAfterCard.current = false;
          setMinimized(null);
          setProgress(null);
          // The card of this try ends with its step, and the dialog takes no more events of it.
          cardEnded();
          call.retry();
        }),
      RETRY_AFTER_MS,
    );
    return () => {
      window.clearTimeout(timer);
      offerRetry(null);
    };
  }, [failed, call, cardEnded]);
  // An event of the card of an older try does nothing: that card ended for the newest try.
  const ofThisTry =
    <A extends unknown[]>(run: ((...args: A) => void) | undefined) =>
    (...args: A) => {
      if (attempt?.newest()) run?.(...args);
    };

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
      {call && attempt && (
        <div className="card-layer">
          <WalletStep
            // Each try is a new step: the card of the try before it ends when its step unmounts.
            key={`${call.id}:${attempt.number}`}
            surface={{
              kind: 'speak_to_sign',
              // The request's own caller handles its result and its error.
              send: (card) =>
                attempt
                  .send(card)
                  .then((result) => {
                    if (!attempt.newest()) return;
                    setSettled(attempt);
                    // The card now shows its result: "view transaction" and "view TDX quote" open its links.
                    showResult(result);
                  })
                  .catch(() => {
                    if (attempt.newest()) setSettled(attempt);
                  })
                  .finally(() => {
                    // The card of an older try ended for a new try: the request goes on.
                    if (!attempt.newest()) return;
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
                    });
                  }),
            }}
            chrome="back_and_close"
            minimize
            transition={VOICE_CARD_TRANSITION}
            onEnter={ofThisTry(voiceCard.events.onEnter)}
            onResize={ofThisTry(voiceCard.events.onResize)}
            onReady={ofThisTry(voiceCard.events.onReady)}
            onExit={ofThisTry(voiceCard.events.onExit)}
            onClose={ofThisTry(() => {
              closeAfterCard.current = true;
            })}
            onMinimize={ofThisTry((restore: () => void) => setMinimized({ restore }))}
            onRestore={ofThisTry(() => setMinimized(null))}
            onProgress={ofThisTry(setProgress)}
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

/**
 * The time that the card shows a result while its request waits, before "try again" by voice
 * counts. A signed request gives its result in that time, and it has no retry.
 */
const RETRY_AFTER_MS = 400;

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
  /**
   * The try of the request that the dialog shows now. It sends the request with the card's
   * place, and the request's caller gets the result of the newest try.
   */
  attempt: CardTry<unknown>;
  /** Starts a new try of the request, with a new card. The dialog ends the card of this try. */
  retry: () => void;
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
          const nextTry = cardTries(send, resolve, reject);
          const start = () => {
            unsent = reject;
            const attempt = nextTry();
            setCall({
              id,
              attempt: {
                ...attempt,
                send: (card: VoiceCard) => {
                  unsent = null;
                  return attempt.send(card);
                },
              },
              retry: start,
              end: () => setCall((current) => (current?.id === id ? null : current)),
            });
          };
          start();
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
