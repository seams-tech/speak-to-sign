import { useId, useMemo, useRef, useState } from 'react';
import { IconArrowLeft, IconCheck, IconCircle, IconSparkles, IconX } from '@tabler/icons-react';
import { suggestSummary } from '../api/summary';
import type { Post } from '../data/posts';
import { useDemo } from '../demoContext';
import type { SignResult } from '../signer/notesSigner';
import { checkSummary, SUMMARY_MAX_WORDS } from '../summaryRules';
import { Modal } from './Modal';
import { SpeakStep, type SignPhase } from './SpeakStep';

const MAX_NOTE_CHARS = 280;
const MAX_SUMMARY_CHARS = 120;

type Classification = 'misleading' | 'not_misleading';

const REASONS: Record<Classification, { question: string; options: string[] }> = {
  misleading: {
    question: 'Why do you believe this post may be misleading?',
    options: [
      'It contains a factual error',
      'It contains a digitally altered photo or video',
      'It contains outdated information that may be misleading',
      'It is a misrepresentation or missing important context',
      'It presents an unverified claim as a fact',
      'It is a joke or satire that might be misinterpreted as a fact',
      'Other',
    ],
  },
  not_misleading: {
    question: 'Why do you believe this post is not misleading?',
    options: ['It expresses a personal opinion', 'It is clearly satire or a joke', 'It states a fact that is correct', 'Other'],
  },
};

interface Props {
  post: Post;
  onClose: () => void;
  /** Called as soon as the Wallet sends `add_note`. */
  onSent: (summary: string, transactionHash: string) => void;
  /** Called when the author closes the success card. */
  onDone: () => void;
}

export function WriteNoteModal({ post, onClose, onSent, onDone }: Props) {
  const { services, account } = useDemo();
  const titleId = useId();
  const [step, setStep] = useState<'write' | 'summary'>('write');
  const [classification, setClassification] = useState<Classification | null>(null);
  const [reasons, setReasons] = useState<string[]>([]);
  const [text, setText] = useState('');
  const [sources, setSources] = useState<'yes' | 'no' | null>(null);
  const [summary, setSummary] = useState('');
  const [suggesting, setSuggesting] = useState(false);
  const [suggestError, setSuggestError] = useState<string | null>(null);
  const [suggested, setSuggested] = useState(false);
  const [phase, setPhase] = useState<SignPhase>({ state: 'idle' });
  const suggestAbort = useRef<AbortController | null>(null);

  const noteChars = [...text].length;
  const noteOk = text.trim() !== '' && noteChars <= MAX_NOTE_CHARS;
  const canGoNext = classification !== null && reasons.length > 0 && noteOk && sources !== null;
  const check = useMemo(() => checkSummary(summary), [summary]);
  const locked = phase.state === 'pending';
  const signing = phase.state !== 'idle';

  const pickClassification = (value: Classification) => {
    if (value !== classification) setReasons([]);
    setClassification(value);
  };

  const toggleReason = (reason: string) => {
    setReasons((current) => (current.includes(reason) ? current.filter((item) => item !== reason) : [...current, reason]));
  };

  const suggest = async () => {
    suggestAbort.current?.abort();
    const controller = new AbortController();
    suggestAbort.current = controller;
    setSuggesting(true);
    setSuggestError(null);
    const result = await suggestSummary(text.trim(), controller.signal);
    if (controller.signal.aborted) return;
    setSuggesting(false);
    if (result.ok) {
      setSummary(result.summary);
      setSuggested(true);
    } else {
      setSuggestError(result.error);
    }
  };

  const close = () => {
    suggestAbort.current?.abort();
    onClose();
  };

  const startSigning = async () => {
    setPhase({ state: 'pending' });
    let result: SignResult;
    try {
      result = await services.signer.requestNote({ postId: post.id, text: text.trim(), summary: check.spoken });
    } catch (cause) {
      result = { kind: 'unavailable', reason: cause instanceof Error ? cause.message : 'The signer failed.' };
    }
    if (result.kind === 'sent') onSent(check.spoken, result.transactionHash);
    setPhase({ state: 'done', result });
  };

  const sent = phase.state === 'done' && phase.result.kind === 'sent';

  return (
    <Modal labelledBy={titleId} onClose={close} locked={locked}>
      <header className="dialog-head">
        {step === 'write' ? (
          <button type="button" className="icon-btn" onClick={close} aria-label="Close">
            <IconX size={20} />
          </button>
        ) : (
          <button type="button" className="icon-btn" onClick={() => setStep('write')} disabled={signing} aria-label="Back to the note">
            <IconArrowLeft size={20} />
          </button>
        )}
        <h2 id={titleId}>Write a Community Note</h2>
        <span className="dialog-step muted">Step {step === 'write' ? 1 : 2} of 2</span>
      </header>

      {step === 'write' ? (
        <>
          <div className="dialog-body">
            <PostQuote post={post} />
            <fieldset className="group">
              <legend className="q">Which of the following best describes this post?</legend>
              <Choice type="radio" name="classification" label="Misinformed or potentially misleading" checked={classification === 'misleading'} onChange={() => pickClassification('misleading')} />
              <Choice type="radio" name="classification" label="Not misleading" checked={classification === 'not_misleading'} onChange={() => pickClassification('not_misleading')} />
            </fieldset>
            {classification && (
              <fieldset className="group">
                <legend className="q">{REASONS[classification].question}</legend>
                {REASONS[classification].options.map((reason) => (
                  <Choice key={reason} type="checkbox" name="reason" label={reason} checked={reasons.includes(reason)} onChange={() => toggleReason(reason)} />
                ))}
              </fieldset>
            )}
            <label className="q q-block" htmlFor={`${titleId}-text`}>
              Explain the evidence behind your choices, and share links to sources
            </label>
            <textarea
              id={`${titleId}-text`}
              className="input note-input"
              rows={4}
              value={text}
              onChange={(event) => setText(event.target.value)}
              aria-describedby={`${titleId}-count`}
            />
            <div id={`${titleId}-count`} className={`counter ${noteChars > MAX_NOTE_CHARS ? 'counter-over' : ''}`}>
              {noteChars} / {MAX_NOTE_CHARS}
            </div>
            <fieldset className="group">
              <legend className="q">Did you link to sources you believe most people would consider trustworthy?</legend>
              <div className="yes-no">
                {(['yes', 'no'] as const).map((value) => (
                  <button key={value} type="button" className={`btn btn-outline btn-choice ${sources === value ? 'btn-choice-on' : ''}`} aria-pressed={sources === value} onClick={() => setSources(value)}>
                    {value === 'yes' ? 'Yes' : 'No'}
                  </button>
                ))}
              </div>
            </fieldset>
          </div>
          <footer className="dialog-foot dialog-foot-end">
            <button type="button" className="btn btn-dark" disabled={!canGoNext} onClick={() => setStep('summary')}>
              Next
            </button>
          </footer>
        </>
      ) : (
        <>
          <div className="dialog-body">
            <div className="note-preview">
              <div className="muted small">Your note on @{post.author.handle}</div>
              <div>{text.trim()}</div>
            </div>
            <label className="q q-block" htmlFor={`${titleId}-summary`}>
              Spoken summary
            </label>
            <p className="muted small field-help">You read this sentence aloud to post the note. Seams checks your voice and these words.</p>
            <textarea
              id={`${titleId}-summary`}
              className="input summary-input"
              rows={2}
              maxLength={MAX_SUMMARY_CHARS}
              placeholder={`Write ${SUMMARY_MAX_WORDS} words or fewer`}
              value={summary}
              disabled={signing}
              onChange={(event) => {
                setSummary(event.target.value.replace(/\n/g, ' '));
                setSuggested(false);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') event.preventDefault();
              }}
              aria-describedby={`${titleId}-rules`}
            />
            <div className="summary-tools">
              <button type="button" className="btn btn-outline btn-sm" onClick={suggest} disabled={suggesting || signing}>
                <IconSparkles size={16} stroke={1.8} aria-hidden="true" />
                {suggesting ? 'Suggesting…' : summary.trim() ? 'Suggest again' : 'Suggest summary'}
              </button>
              <span className="muted small" aria-live="polite">
                {suggesting ? 'NEAR AI is writing a summary' : suggested ? 'Suggested by NEAR AI. You can edit it.' : ''}
              </span>
              <span className={`word-count ${check.words > SUMMARY_MAX_WORDS ? 'counter-over' : ''}`}>
                {check.words} / {SUMMARY_MAX_WORDS} words
              </span>
            </div>
            {suggestError && (
              <p className="field-error" role="alert">
                {suggestError}
              </p>
            )}
            <ul id={`${titleId}-rules`} className="rules" aria-label="Summary rules">
              {check.rules.map((rule) => {
                const state = summary.trim() === '' ? 'empty' : rule.ok ? 'ok' : 'bad';
                return (
                  <li key={rule.id} className={`rule rule-${state}`}>
                    {state === 'ok' ? <IconCheck size={15} stroke={2.6} aria-hidden="true" /> : state === 'bad' ? <IconX size={15} stroke={2.6} aria-hidden="true" /> : <IconCircle size={13} stroke={2} aria-hidden="true" />}
                    <span>
                      {rule.label}
                      <span className="sr-only">{state === 'ok' ? ': passes' : state === 'bad' ? ': fails' : ''}</span>
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
          <footer className="dialog-foot">
            <SpeakStep
              phase={phase}
              sentence={check.spoken}
              buttonLabel="Read it aloud to post"
              hint="Your voice signs the note. No confirm tap."
              disabled={!check.ok}
              disabledHint={summary.trim() === '' ? 'Write or suggest a summary first.' : 'Fix the summary to continue.'}
              accountId={account}
              wordsLine="Words matched the summary"
              signedLine="Note signed and submitted"
              nothingLine="Nothing was posted."
              onStart={startSigning}
              onRetry={() => setPhase({ state: 'idle' })}
              onDone={sent ? onDone : close}
            />
          </footer>
        </>
      )}
    </Modal>
  );
}

export function PostQuote({ post }: { post: Post }) {
  return (
    <div className="post-quote">
      <b>{post.author.name}</b> <span className="muted">@{post.author.handle}</span>
      <div>{post.text}</div>
    </div>
  );
}

export function Choice({ type, name, label, checked, onChange }: { type: 'radio' | 'checkbox'; name: string; label: string; checked: boolean; onChange: () => void }) {
  return (
    <label className={`choice ${checked ? 'choice-on' : ''} ${type === 'checkbox' ? 'choice-check' : ''}`}>
      <span>{label}</span>
      <input type={type} name={name} checked={checked} onChange={onChange} className="sr-only-input" />
      <span className={type === 'radio' ? 'radio' : 'box'} aria-hidden="true">
        {type === 'checkbox' && checked && <IconCheck size={14} stroke={3} />}
      </span>
    </label>
  );
}
