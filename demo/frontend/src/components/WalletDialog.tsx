// One dialog for one flow. The Wallet's cards are steps of the same dialog, in place of a second
// dialog on top: the sign-in, and the voice card of a Speak-to-Sign request. The dialog changes
// into the card, then back to its own step, which stays mounted (hidden) and keeps its state.

import { useContext, useEffect, useId, useState, type ReactNode, type Ref } from 'react';
import { WalletStep } from '@seams/wallet/react';
import { DemoContext } from '../demoContext';
import { hostVoiceCard, type VoiceCard } from '../signer/voiceCard';
import { Modal, useDialogHeight, type ModalHandle } from './Modal';
import { Morph, MorphView } from './Morph';
import { SignInStep } from './SignInModal';

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
  const card = useVoiceCardHost();
  const stepTitleId = useId();
  const view = signingIn ? 'signin' : card ? 'voice' : 'main';
  return (
    <Modal
      labelledBy={view === 'main' ? titleId : stepTitleId}
      onClose={onClose}
      // The voice card ends with its own Close. The sign-in goes back with Escape.
      locked={(locked || card !== null) && !signingIn}
      handle={handle}
      onOutside={signingIn ? () => end(false) : undefined}
    >
      <Morph view={view} flex>
        <MorphView name="main" keep>
          {children}
        </MorphView>
        {signingIn && (
          <MorphView name="signin">
            <SignInStep titleId={stepTitleId} onSignedIn={() => end(true)} onBack={() => end(false)} />
          </MorphView>
        )}
        {card && (
          <MorphView name="voice">
            <VoiceCardStep key={card.id} titleId={stepTitleId} send={card.send} />
          </MorphView>
        )}
      </Morph>
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
  send: (card: VoiceCard) => Promise<unknown>;
}

let nextCallId = 1;

/**
 * Makes this dialog the host of the voice card while it is open. The result is the request that
 * waits for its card, if any: the dialog then shows VoiceCardStep, which sends it.
 */
function useVoiceCardHost(): CardCall | null {
  const [call, setCall] = useState<CardCall | null>(null);
  useEffect(() => {
    // The request that the step has not sent yet. If the dialog closes first, it ends.
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
              } finally {
                setCall((current) => (current?.id === id ? null : current));
              }
            },
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

/**
 * The Wallet's voice card as a step of the dialog. The card stays in the Wallet's iframe: the SDK
 * places it over this step, and the step takes the card's size. Until the card has its size, the
 * step keeps the height of the step before it, so the dialog changes its size once.
 */
function VoiceCardStep({ titleId, send }: { titleId: string; send: CardCall['send'] }) {
  const dialogHeight = useDialogHeight();
  const [initialHeight] = useState(dialogHeight);
  return (
    <>
      <h2 id={titleId} className="sr-only">
        Say the sentence in the Seams Wallet card
      </h2>
      {/* The request's own caller handles its result and its error. */}
      <WalletStep
        className="wallet-step"
        surface={{ kind: 'speak_to_sign', send: (card) => send(card).catch(() => undefined) }}
        initialHeight={initialHeight}
      />
    </>
  );
}
