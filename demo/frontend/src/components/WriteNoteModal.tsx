import { useEffect, useId, useMemo, useState } from 'react';
import { IconX } from '@tabler/icons-react';
import { summaryRefusal } from '@seams/wallet';
import type { Post } from '../data/posts';
import { useDemo } from '../demoContext';
import type { SignResult } from '../signer/notesSigner';
import { checkSummary, SUMMARY_MAX_WORDS } from '../summaryRules';
import { Modal } from './Modal';
import { SpeakStep, type SignPhase } from './SpeakStep';

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
  /** Called when the author closes the success card. */
  onDone: () => void;
}

/**
 * One short dialog: the note, the sentence to read aloud, and the button that reads it. The demo
 * post has both filled in (Post.noteDraft), so a visitor only presses the button and speaks. Both
 * stay editable. The contract stores the note and the spoken summary; nothing else is asked.
 */
export function WriteNoteModal({ post, onClose, onSent, onDone }: Props) {
  const { signer, account, status, openSignIn } = useDemo();
  const titleId = useId();
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
  const locked = phase.state === 'pending';
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
    setPhase({ state: 'pending' });
    let result: SignResult;
    try {
      result = await signer.requestNote({ postId: post.id, text: text.trim(), summary: check.spoken });
    } catch (cause) {
      result = { kind: 'unavailable', reason: cause instanceof Error ? cause.message : 'The signer failed.' };
    }
    if (result.kind === 'sent') onSent(check.spoken, result.transactionHash);
    setPhase({ state: 'done', result });
  };

  const sent = phase.state === 'done' && phase.result.kind === 'sent';
  const summaryProblem =
    !typing && summary.trim() !== '' && !speakable ? `Use 1 to ${SUMMARY_MAX_WORDS} words, with letters A to Z only.` : null;

  return (
    <Modal labelledBy={titleId} onClose={onClose} locked={locked}>
      <header className="dialog-head">
        <button type="button" className="icon-btn" onClick={onClose} disabled={locked} aria-label="Close">
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
          hint="Your voice signs the note. No confirm tap."
          disabled={typing || !speakable || !noteOk}
          disabledHint={typing ? 'Filling in the sentence…' : !noteOk ? 'Write the note first.' : 'Write the sentence to read first.'}
          needsSignIn={!status?.signedIn}
          onSignIn={openSignIn}
          accountId={account}
          wordsLine="Words matched the summary"
          signedLine="Note signed and submitted"
          nothingLine="Nothing was posted."
          onStart={startSigning}
          onRetry={() => setPhase({ state: 'idle' })}
          onDone={sent ? onDone : onClose}
        />
      </footer>
    </Modal>
  );
}
