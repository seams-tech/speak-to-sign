import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { IconX } from '@tabler/icons-react';
import { summaryRefusal } from '@seams/wallet';
import type { Post } from '../data/posts';
import { useDemo } from '../demoContext';
import { useEnrolled } from '../signer/voiceSetup';
import { checkSummary, SUMMARY_MAX_WORDS } from '../summaryRules';
import type { ModalHandle } from './Modal';
import { WalletDialog } from './WalletDialog';
import { runVoiceAction, SpeakStep, speakHint, useAutoClose, useAutoStart, type SignPhase } from './SpeakStep';

const MAX_NOTE_CHARS = 280;
const MAX_SUMMARY_CHARS = 120;
/** The prefilled note and sentence type themselves in, so it is clear that the page filled them in. */
const TYPE_START_MS = 450;
const TYPE_STEP_MS = 26;
/** The note is longer than the sentence, so it types several letters for each step: about a second in all. */
const NOTE_TYPE_MS = 1_000;
const NOTE_STEP_MS = 16;
/** The pause between the note and the sentence. */
const TYPE_GAP_MS = 220;

function prefersLessMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

interface Props {
  post: Post;
  onClose: () => void;
  /** Called as soon as the Wallet sends `add_note`. */
  onSent: (summary: string, transactionHash: string) => void;
  /** Called when the success card closes (by itself, or with Done). */
  onDone: () => void;
  /** Start the spoken step as soon as the draft is in: the visitor asked for the note by voice. */
  autoSign?: boolean;
}

/**
 * One short dialog: the note, the sentence to read aloud, and the button that reads it. Each
 * post has both filled in (Post.noteDraft), and they type themselves in, so a visitor only
 * presses the button and speaks. Both stay editable. The contract stores the note and the spoken summary; nothing else is asked.
 *
 * The button also runs what is still missing first: sign in, set up the voice, testnet NEAR. After
 * the note posts, the dialog shows the result for a moment and closes by itself.
 */
export function WriteNoteModal({ post, onClose, onSent, onDone, autoSign = false }: Props) {
  const { account, status, prepare } = useDemo();
  const enrolled = useEnrolled(account);
  const modal = useRef<ModalHandle>(null);
  const titleId = useId();
  const draft = post.noteDraft;
  const prefillNote = draft?.text ?? '';
  const prefill = draft?.summary ?? '';
  // First the note types itself in, then the sentence. With reduced motion, both are there at once.
  const [typingNote, setTypingNote] = useState(() => prefillNote !== '' && !prefersLessMotion());
  const [text, setText] = useState(() => (typingNote ? '' : prefillNote));
  const [typing, setTyping] = useState(() => prefill !== '' && !prefersLessMotion());
  const [summary, setSummary] = useState(() => (typing ? '' : prefill));
  const [phase, setPhase] = useState<SignPhase>({ state: 'idle' });

  const noteChars = [...text].length;
  const noteOk = text.trim() !== '' && noteChars <= MAX_NOTE_CHARS;
  const check = useMemo(() => checkSummary(summary), [summary]);
  // The page's rule check ports the SDK; the SDK's own check is the final gate.
  const speakable = check.ok && summaryRefusal(check.spoken) === null;
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

  // Then type the prefilled sentence in, one letter at a time. A key from the visitor stops it.
  useEffect(() => {
    if (!typing || typingNote) return;
    let shown = 0;
    let timer = 0;
    const step = () => {
      shown += 1;
      setSummary(prefill.slice(0, shown));
      if (shown < prefill.length) timer = window.setTimeout(step, TYPE_STEP_MS);
      else setTyping(false);
    };
    timer = window.setTimeout(step, prefillNote === '' ? TYPE_START_MS : TYPE_GAP_MS);
    return () => window.clearTimeout(timer);
  }, [typing, typingNote, prefill, prefillNote]);

  const startSigning = async () => {
    const note = { postId: post.id, text: text.trim(), summary: check.spoken };
    const result = await runVoiceAction(prepare, !!status?.signedIn, setPhase, (signer) => signer.requestNote(note));
    if (result?.kind === 'sent') onSent(note.summary, result.transactionHash);
  };

  // A voice command asked for the note: once the prefilled draft is in, the button waits a
  // moment, then the Wallet card comes.
  const draftReady = !typingNote && !typing && speakable && noteOk;
  useAutoStart(autoSign, draftReady && phase.state === 'idle', () => void startSigning());

  const sent = phase.state === 'done' && phase.result.kind === 'sent';
  const finish = () => modal.current?.close(onDone);
  useAutoClose(sent, finish);
  const summaryProblem =
    !typing && summary.trim() !== '' && !speakable ? `Use 1 to ${SUMMARY_MAX_WORDS} words, with letters A to Z only.` : null;

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
              className={`wn-note ${typingNote ? 'summary-typing' : ''}`}
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
            <label className="q q-block" htmlFor={`${titleId}-summary`}>
              Read this aloud to post
            </label>
            <textarea
              id={`${titleId}-summary`}
              className={`input summary-input ${typing ? 'summary-typing' : ''}`}
              rows={2}
              maxLength={MAX_SUMMARY_CHARS}
              value={summary}
              disabled={signing}
              onChange={(event) => {
                setTyping(false);
                setSummary(event.target.value.replace(/\n/g, ' '));
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') event.preventDefault();
              }}
              aria-invalid={summaryProblem !== null}
            />
            {summaryProblem && (
              <p className="field-error" role="alert">
                {summaryProblem}
              </p>
            )}
          </div>
          <footer className="dialog-foot">
            <SpeakStep
              phase={phase}
              sentence={check.spoken}
              buttonLabel="Read it aloud to post"
              hint={speakHint(!!status?.signedIn, !!status?.voiceReady && enrolled, 'Your voice signs the note. No confirm tap.')}
              disabled={typingNote || typing || !speakable || !noteOk}
              disabledHint={typingNote ? 'Filling in the note…' : typing ? 'Filling in the sentence…' : !noteOk ? 'Write the note first.' : 'Write the sentence to read first.'}
              accountId={account}
              wordsLine="Words matched the summary"
              signedLine="Note signed and submitted"
              nothingLine="Nothing was posted."
              onStart={startSigning}
              onRetry={() => setPhase({ state: 'idle' })}
              onDone={sent ? finish : () => modal.current?.close()}
            />
          </footer>
    </WalletDialog>
  );
}
