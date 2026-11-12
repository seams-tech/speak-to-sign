import { useId, useRef, useState } from 'react';
import { IconX } from '@tabler/icons-react';
import type { Note } from '../notes/types';
import { RATING_LABELS, useDemo } from '../demoContext';
import { RATING_SENTENCES, type Rating } from '../signer/notesSigner';
import { useEnrolled } from '../signer/voiceSetup';
import { shortAccount } from '../config';
import { Linkified } from './bits';
import type { ModalHandle } from './Modal';
import { WalletDialog } from './WalletDialog';
import { runVoiceAction, SpeakStep, speakHint, useAutoStart, type SignPhase } from './SpeakStep';

const OPTIONS: { rating: Rating; answer: string }[] = [
  { rating: 'helpful', answer: 'Yes' },
  { rating: 'somewhat_helpful', answer: 'Somewhat' },
  { rating: 'not_helpful', answer: 'No' },
];

interface Props {
  note: Note;
  onClose: () => void;
  /** Called as soon as the Wallet sends `rate_note`. */
  onSent: (rating: Rating, transactionHash: string) => void;
  /** Called when the success card closes (by itself, or with Done). */
  onDone: () => void;
  /** The answer that the dialog opens with. */
  initialRating?: Rating;
  /** Start the spoken step at once, with `initialRating`: the visitor asked for it by voice. */
  autoSign?: boolean;
}

export function RateNoteModal({ note, onClose, onSent, onDone, initialRating, autoSign = false }: Props) {
  const { account, status, myRatings, prepare } = useDemo();
  const enrolled = useEnrolled(account);
  const modal = useRef<ModalHandle>(null);
  const titleId = useId();
  const previous = myRatings[note.id];
  const [choice, setChoice] = useState<Rating | null>(initialRating ?? null);
  const [phase, setPhase] = useState<SignPhase>({ state: 'idle' });
  const signing = phase.state !== 'idle';
  const locked = phase.state === 'pending' || phase.state === 'preparing';

  const startSigning = async () => {
    if (!choice) return;
    const rating = choice;
    const result = await runVoiceAction(prepare, !!status?.signedIn, setPhase, (signer) =>
      signer.requestRating({ noteId: note.id, rating }),
    );
    if (result?.kind !== 'sent') return;
    onSent(rating, result.transactionHash);
    // The Wallet card showed the result and its receipt: the dialog closes at once.
    finish();
  };

  // A voice command asked for the rating: the button waits a moment, then the Wallet card comes.
  useAutoStart(autoSign, choice !== null && phase.state === 'idle', () => void startSigning());

  const finish = () => modal.current?.close(onDone);

  return (
    <WalletDialog titleId={titleId} onClose={onClose} locked={locked} handle={modal}>
      <header className="dialog-head">
            <button type="button" className="icon-btn" onClick={() => modal.current?.close()} disabled={locked} aria-label="Close">
              <IconX size={20} />
            </button>
            <h2 id={titleId}>Rate this note</h2>
          </header>
          <div className="dialog-body">
            <div className="note-preview">
              <div className="muted small">Note by {shortAccount(note.author)}</div>
              <div>
                <Linkified text={note.text} />
              </div>
            </div>
            <fieldset className="group" disabled={signing}>
              <legend className="q">Is this note helpful?</legend>
              <p className="muted small field-help">
                Pick one answer. Then say its sentence aloud.
                {previous && ` Your rating now: ${RATING_LABELS[previous]}.`}
              </p>
              {OPTIONS.map(({ rating, answer }) => (
                <label key={rating} className={`choice choice-tall ${choice === rating ? 'choice-on' : ''}`}>
                  <span>
                    <b>{answer}</b>
                    <span className="say-line">
                      Say <q className="say">{RATING_SENTENCES[rating]}</q>
                    </span>
                  </span>
                  <input type="radio" name="rating" className="sr-only-input" checked={choice === rating} onChange={() => setChoice(rating)} />
                  <span className="radio" aria-hidden="true" />
                </label>
              ))}
            </fieldset>
          </div>
          <footer className="dialog-foot">
            <SpeakStep
              phase={phase}
              sentence={choice ? RATING_SENTENCES[choice] : ''}
              buttonLabel="Say it aloud to rate"
              hint={speakHint(!!status?.signedIn, !!status?.voiceReady && enrolled, 'Your voice signs the rating. No confirm tap.')}
              disabled={!choice}
              disabledHint="Pick one answer first."
              nothingTitle="Nothing was rated"
              onStart={startSigning}
              onRetry={() => setPhase({ state: 'idle' })}
            />
          </footer>
    </WalletDialog>
  );
}
