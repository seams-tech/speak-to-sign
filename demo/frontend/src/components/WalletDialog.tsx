// One dialog for one flow. The Wallet's cards are steps of the same dialog, in place of a second
// dialog on top: the sign-in, and the voice card of a Speak-to-Sign request. The dialog changes
// into the card, then back to its own step, which stays mounted (hidden) and keeps its state.
//
// A Wallet card is an iframe above the page, which the SDK fades in and out over an element of
// the dialog (the anchor). The dialog shows one surface at each moment:
// - Its own surface is opaque until the card is fully painted, so the page never shows through
//   the two of them. It is opaque again in the frame in which the card starts to leave.
// - It has the card's size before the card shows.
// - Its own step returns when the card is gone.

import { useContext, useEffect, useId, useState, type ReactNode, type Ref } from 'react';
import { WalletStep } from '@seams/wallet/react';
import { DemoContext } from '../demoContext';
import { hostVoiceCard, type VoiceCard } from '../signer/voiceCard';
import { Modal, useDialogHeight, type ModalHandle } from './Modal';
import { Morph, MorphView } from './Morph';
import { SignInStep } from './SignInModal';
import { useWalletCard } from './useWalletCard';

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
  const stepTitleId = useId();
  const view = signingIn ? 'signin' : call ? 'voice' : 'main';

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
      // The voice card ends with its own Close. The sign-in goes back with Escape.
      locked={(locked || call !== null) && !signingIn}
      handle={handle}
      onOutside={signingIn ? () => leaveSignIn(false) : undefined}
    >
      <Morph view={view} flex>
        <MorphView name="main" keep>
          {children}
        </MorphView>
        {signingIn && (
          <MorphView name="signin" bare>
            <SignInStep titleId={stepTitleId} card={signInCard} ended={signInEnded} onLeave={leaveSignIn} />
          </MorphView>
        )}
        {call && (
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
                  .catch(() => undefined)
                  .finally(() => voiceCard.afterCard(call.end)),
            }}
            {...voiceCard.events}
          />
        </div>
      )}
    </Modal>
  );
}

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
