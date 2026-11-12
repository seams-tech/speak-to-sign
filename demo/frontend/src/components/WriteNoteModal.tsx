import { useEffect, useId, useRef, useState } from 'react';
import { IconX } from '@tabler/icons-react';
import type { Post } from '../data/posts';
import { useDemo } from '../demoContext';
import { useEnrolled } from '../signer/voiceSetup';
import type { ModalHandle } from './Modal';
import { WalletDialog } from './WalletDialog';
import { runVoiceAction, SpeakStep, speakHint, useAutoStart, type SignPhase } from './SpeakStep';

const MAX_NOTE_CHARS = 280;
/** The prefilled note types itself in, so it is clear that the page filled it in. */
const TYPE_START_MS = 450;
/** It types several letters for each step: about a second in all. */
const NOTE_TYPE_MS = 1_000;
const NOTE_STEP_MS = 16;

function prefersLessMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

interface Props {
  post: Post;
  onClose: () => void;
  /** Called as soon as the Wallet sends `add_note`, with the note text. */
  onSent: (text: string, transactionHash: string) => void;
  /** Called when the success card closes (by itself, or with Done). */
  onDone: () => void;
  /** Start the spoken step as soon as the draft is in: the visitor asked for the note by voice. */
  autoSign?: boolean;
}

/**
 * One short dialog: the note and the button that signs it. Each post has a note filled in
 * (Post.noteDraft), and it types itself in, so a visitor only presses the button and speaks. The
 * note stays editable. The Seams server writes a short summary of the note, and the Wallet card
 * shows the note with the summary to read aloud: the page cannot choose the words. The verifier
 * checks that the summary fits the note. The contract stores the note and the spoken summary.
 *
 * The button also runs what is still missing first: sign in, set up the voice, testnet NEAR. The
 * Wallet card shows the posted note with its TEE receipt. Its Done closes the card, and the
 * dialog closes with it.
 */
export function WriteNoteModal({ post, onClose, onSent, onDone, autoSign = false }: Props) {
  const { account, status, prepare } = useDemo();
  const enrolled = useEnrolled(account);
  const modal = useRef<ModalHandle>(null);
  const titleId = useId();
  const prefillNote = post.noteDraft?.text ?? '';
  // The note types itself in. With reduced motion, it is there at once.
  const [typingNote, setTypingNote] = useState(() => prefillNote !== '' && !prefersLessMotion());
  const [text, setText] = useState(() => (typingNote ? '' : prefillNote));
  const [phase, setPhase] = useState<SignPhase>({ state: 'idle' });

  const noteChars = [...text].length;
  const noteOk = text.trim() !== '' && noteChars <= MAX_NOTE_CHARS;
  const locked = phase.state === 'pending' || phase.state === 'preparing';
  const signing = phase.state !== 'idle';

  // Type the prefilled note in, a few letters at a time. A key from the visitor stops it.
  useEffect(() => {
    if (!typingNote) return;
    const letters = [...prefillNote];
    const stride = Math.max(1, Math.ceil(letters.length / (NOTE_TYPE_MS / NOTE_STEP_MS)));
    let shown = 0;
    let timer = 0;
    const step = () => {
      shown = Math.min(letters.length, shown + stride);
      setText(letters.slice(0, shown).join(''));
      if (shown < letters.length) timer = window.setTimeout(step, NOTE_STEP_MS);
      else setTypingNote(false);
    };
    timer = window.setTimeout(step, TYPE_START_MS);
    return () => window.clearTimeout(timer);
  }, [typingNote, prefillNote]);

  // The Wallet card shows the result and its receipt, and its Done ends it: the dialog then
  // closes at once, with no result of its own.
  const finish = () => modal.current?.close(onDone);
  const startSigning = async () => {
    const note = { postId: post.id, text: text.trim() };
    const result = await runVoiceAction(prepare, !!status?.signedIn, setPhase, (signer) => signer.requestNote(note));
    if (result?.kind !== 'sent') return;
    onSent(note.text, result.transactionHash);
    finish();
  };

  // A voice command asked for the note: once the prefilled draft is in, the button waits a
  // moment, then the Wallet card comes.
  const draftReady = !typingNote && noteOk;
  useAutoStart(autoSign, draftReady && phase.state === 'idle', () => void startSigning());


  return (
    <WalletDialog titleId={titleId} onClose={onClose} locked={locked} handle={modal}>
      <header className="dialog-head">
            <button type="button" className="icon-btn" onClick={() => modal.current?.close()} disabled={locked} aria-label="Close">
              <IconX size={20} />
            </button>
            <h2 id={titleId}>Write a Community Note</h2>
          </header>
          <div className="dialog-body">
            <label className="wn-label muted small" htmlFor={`${titleId}-text`}>
              Your note on @{post.author.handle}
            </label>
            <textarea
              id={`${titleId}-text`}
              className={`wn-note ${typingNote ? 'note-typing' : ''}`}
              rows={5}
              value={text}
              disabled={signing}
              onChange={(event) => {
                setTypingNote(false);
                setText(event.target.value);
              }}
              aria-invalid={!noteOk}
            />
            {noteChars > MAX_NOTE_CHARS && (
              <p className="field-error" role="alert">
                The note has {noteChars} characters. Use {MAX_NOTE_CHARS} or fewer.
              </p>
            )}
          </div>
          <footer className="dialog-foot">
            <SpeakStep
              phase={phase}
              buttonLabel="Sign the note with your voice"
              hint={speakHint(!!status?.signedIn, !!status?.voiceReady && enrolled, 'You read a short summary of the note aloud.')}
              disabled={typingNote || !noteOk}
              disabledHint={typingNote ? 'Filling in the note…' : 'Write the note first.'}
              nothingTitle="Nothing was posted"
              onStart={startSigning}
              onRetry={() => setPhase({ state: 'idle' })}
            />
          </footer>
    </WalletDialog>
  );
}
