import { useId, useState } from 'react';
import { IconX } from '@tabler/icons-react';
import type { Note } from '../notes/types';
import { RATING_LABELS, useDemo } from '../demoContext';
import { RATING_SENTENCES, type Rating, type SignResult } from '../signer/notesSigner';
import { shortAccount } from '../config';
import { Linkified } from './bits';
import { Modal } from './Modal';
import { SpeakStep, type SignPhase } from './SpeakStep';

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
  /** Called when the rater closes the success card. */
  onDone: () => void;
}

export function RateNoteModal({ note, onClose, onSent, onDone }: Props) {
  const { signer, account, status, myRatings, openSignIn } = useDemo();
  const titleId = useId();
  const previous = myRatings[note.id];
  const [choice, setChoice] = useState<Rating | null>(null);
  const [phase, setPhase] = useState<SignPhase>({ state: 'idle' });
  const signing = phase.state !== 'idle';

  const startSigning = async () => {
    if (!choice) return;
    setPhase({ state: 'pending' });
    let result: SignResult;
    try {
      result = await signer.requestRating({ noteId: note.id, rating: choice });
    } catch (cause) {
      result = { kind: 'unavailable', reason: cause instanceof Error ? cause.message : 'The signer failed.' };
    }
    if (result.kind === 'sent') onSent(choice, result.transactionHash);
    setPhase({ state: 'done', result });
  };

  const sent = phase.state === 'done' && phase.result.kind === 'sent';

  return (
    <Modal labelledBy={titleId} onClose={onClose} locked={phase.state === 'pending'}>
      <header className="dialog-head">
        <button type="button" className="icon-btn" onClick={onClose} disabled={phase.state === 'pending'} aria-label="Close">
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
          hint="Your voice signs the rating. No confirm tap."
          disabled={!choice}
          disabledHint="Pick one answer first."
          needsSignIn={!status?.signedIn}
          onSignIn={openSignIn}
          accountId={account}
          wordsLine="Words matched your rating"
          signedLine="Rating signed"
          nothingLine="Nothing was rated."
          onStart={startSigning}
          onRetry={() => setPhase({ state: 'idle' })}
          onDone={sent ? onDone : onClose}
        />
      </footer>
    </Modal>
  );
}
