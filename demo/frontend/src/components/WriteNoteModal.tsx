import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { IconX } from '@tabler/icons-react';
import { summaryRefusal } from '@seams/wallet';
import type { Post } from '../data/posts';
import { useDemo } from '../demoContext';
import { useEnrolled } from '../signer/voiceSetup';
import { checkSummary, SUMMARY_MAX_WORDS } from '../summaryRules';
import { Modal, type ModalHandle } from './Modal';
import { Morph, MorphView } from './Morph';
import { SignInStep } from './SignInModal';
import { runVoiceAction, SpeakStep, speakHint, useAutoClose, type SignPhase } from './SpeakStep';

const MAX_NOTE_CHARS = 280;
const MAX_SUMMARY_CHARS = 120;
/** The prefilled sentence types itself in, so it is clear that the page filled it in. */
const TYPE_START_MS = 450;
const TYPE_STEP_MS = 26;

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
}

/**
 * One short dialog: the note, the sentence to read aloud, and the button that reads it. The demo
 * post has both filled in (Post.noteDraft), so a visitor only presses the button and speaks. Both
 * stay editable. The contract stores the note and the spoken summary; nothing else is asked.
 *
 * The button also runs what is still missing first: sign in, set up the voice, testnet NEAR. After
 * the note posts, the dialog shows the result for a moment and closes by itself.
 */
export function WriteNoteModal({ post, onClose, onSent, onDone }: Props) {
  const { account, status, prepare, signingIn, hostSignIn, endSignIn } = useDemo();
  useEffect(() => hostSignIn(), [hostSignIn]);
  const enrolled = useEnrolled(account);
  const modal = useRef<ModalHandle>(null);
  const titleId = useId();
  const signInTitleId = useId();
  const draft = post.noteDraft;
  const [text, setText] = useState(draft?.text ?? '');
  const prefill = draft?.summary ?? '';
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

  // Type the prefilled sentence in, one letter at a time. A key from the visitor stops it.
  useEffect(() => {
    if (!typing) return;
    let shown = 0;
    let timer = 0;
    const step = () => {
      shown += 1;
      setSummary(prefill.slice(0, shown));
      if (shown < prefill.length) timer = window.setTimeout(step, TYPE_STEP_MS);
      else setTyping(false);
    };
    timer = window.setTimeout(step, TYPE_START_MS);
    return () => window.clearTimeout(timer);
  }, [typing, prefill]);

  const startSigning = async () => {
    const note = { postId: post.id, text: text.trim(), summary: check.spoken };
    const result = await runVoiceAction(prepare, !!status?.signedIn, setPhase, (signer) => signer.requestNote(note));
    if (result?.kind === 'sent') onSent(note.summary, result.transactionHash);
  };

  const sent = phase.state === 'done' && phase.result.kind === 'sent';
  const finish = () => modal.current?.close(onDone);
  useAutoClose(sent, finish);
  const summaryProblem =
    !typing && summary.trim() !== '' && !speakable ? `Use 1 to ${SUMMARY_MAX_WORDS} words, with letters A to Z only.` : null;

  return (
    <Modal
      labelledBy={signingIn ? signInTitleId : titleId}
      onClose={onClose}
      locked={locked && !signingIn}
      handle={modal}
      onOutside={signingIn ? () => endSignIn(false) : undefined}
    >
      <Morph view={signingIn ? 'signin' : 'compose'} flex>
        {/* Kept while the sign-in shows: what the visitor wrote stays as it was. */}
        <MorphView name="compose" keep>
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
              className="wn-note"
              rows={5}
              value={text}
              disabled={signing}
              onChange={(event) => setText(event.target.value)}
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
              disabled={typing || !speakable || !noteOk}
              disabledHint={typing ? 'Filling in the sentence…' : !noteOk ? 'Write the note first.' : 'Write the sentence to read first.'}
              accountId={account}
              wordsLine="Words matched the summary"
              signedLine="Note signed and submitted"
              nothingLine="Nothing was posted."
              onStart={startSigning}
              onRetry={() => setPhase({ state: 'idle' })}
              onDone={sent ? finish : () => modal.current?.close()}
            />
          </footer>
        </MorphView>
        {signingIn && (
          <MorphView name="signin">
            <SignInStep titleId={signInTitleId} onSignedIn={() => endSignIn(true)} onBack={() => endSignIn(false)} />
          </MorphView>
        )}
      </Morph>
    </Modal>
  );
}
