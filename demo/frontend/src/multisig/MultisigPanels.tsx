// The two working parts of the multisig screen: the proposal form and an open proposal in the
// history. The visitor picks a reported note to hide (or types a transfer) and reads the
// proposal aloud: the page records it, asks /api/voice-verify, and on an accept signs `propose`
// with the Seams Wallet. Then the page sends the opening to /api/multisig/approve: the two admin
// signers approve, and admin B executes. The page shows three ticks (your approval, Admin A,
// Admin B) and the receipt. Until the proposal is executed, this browser keeps the opening, and
// **Finish the proposal** calls the route again.
//
// The admins approve by key (docs/voice-intents-spec.md). For the demo, the page shows them
// as signers like the visitor: no key icon and no words about keys.

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { IconCheck, IconExternalLink, IconEyeOff, IconSend } from '@tabler/icons-react';
import { accountUrl, config, shortAccount, shortHash, transactionUrl } from '../config';
import { covers, useFunds } from '../faucet/funds';
import type { SignResult } from '../signer/notesSigner';
import { useEnrolled } from '../signer/voiceSetup';
import { RpcNotesStore } from '../notes/rpcStore';
import type { Note } from '../notes/types';
import { requestApproval } from './approveClient';
import { formatNear, formatYocto, hideSentence, isSpeakableAccount, parseNearAmount, proposalSentence } from './intent';
import type { MultisigSigner } from './multisigSigner';
import { isHide, readOpening, removeOpening, writeOpening, type Opening } from './openings';
import { PRACTICE_POST_ID } from './practice';
import type { MultisigConfig, Proposal } from './contractViews';
import { getProposal } from './views';
import { checkVoice } from './voiceVerify';
import { VoiceRecorder } from './VoiceRecorder';

/** What the panels need from the screen. */
export interface MultisigContext {
  contract: string;
  account: string | undefined;
  config: MultisigConfig | null;
  /** The contract is not deployed: the screen shows example data, and nothing records. */
  demo: boolean;
  signer: MultisigSigner;
  onSignIn?: () => void;
  /** A transaction was sent for this proposal: read the contract again until it shows. */
  onSent: (proposalId: number) => void;
}

const DEMO_NOTE = 'Contract not deployed yet. This is example data, so nothing records or signs.';
const DEFAULT_RECEIVER = 'seams-grants.testnet';
const DEFAULT_AMOUNT = '0.01';
const POLL_MS = 1500;

/** "Admin A", "Admin B", … in the order of `get_config().admins`. */
export function adminName(index: number): string {
  return `Admin ${String.fromCharCode(65 + index)}`;
}

type VoiceStep = { kind: 'idle' } | { kind: 'checking' } | { kind: 'signing' } | { kind: 'failed'; message: string; heard?: string };

const BUSY: Partial<Record<VoiceStep['kind'], string>> = {
  checking: 'Checking your voice…',
  signing: 'Confirm in the Wallet…',
};

function signFailure(result: Exclude<SignResult, { kind: 'sent' }>): string {
  return result.kind === 'cancelled' ? 'You closed the Wallet. Nothing was signed.' : result.reason;
}

function VoiceMessage({ step }: { step: VoiceStep }) {
  if (step.kind === 'failed') {
    return (
      <div className="lms-error" role="alert">
        <p>{step.message}</p>
        {step.heard !== undefined && <p>The verifier heard: “{step.heard}”.</p>}
      </div>
    );
  }
  if (step.kind === 'signing') {
    return <p className="lms-hint">The verdict is valid for two minutes. Confirm the transaction in the Wallet now.</p>;
  }
  return null;
}

function TxLink({ hash }: { hash: string }) {
  return (
    <a href={transactionUrl(hash)} target="_blank" rel="noopener noreferrer">
      Tx {shortHash(hash)} <IconExternalLink size={12} stroke={2} />
    </a>
  );
}

type Finish =
  | { kind: 'idle' }
  | { kind: 'running' }
  /** `transactionHash` is null when an earlier call executed it. */
  | { kind: 'done'; opening: Opening; transactionHash: string | null }
  | { kind: 'failed'; message: string };

/** A transfer or a hide: the words of the steps that differ. */
type ProposalKind = 'transfer' | 'hide';

const kindOf = (opening: Opening): ProposalKind => (isHide(opening) ? 'hide' : 'transfer');

/**
 * The approve route for one proposal. While it runs, the page reads the proposal, so each admin
 * tick shows when its approval lands.
 */
function useFinish(context: MultisigContext) {
  const [finish, setFinish] = useState<Finish>({ kind: 'idle' });
  const [live, setLive] = useState<Proposal | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  /** `held`: the opening in memory, for a browser that could not store it. */
  const run = async (proposalId: number, held?: Opening) => {
    const opening = held ?? readOpening(context.contract, proposalId);
    if (!opening) {
      setFinish({ kind: 'failed', message: 'This browser has no opening for this proposal, so it cannot finish it.' });
      return;
    }
    setFinish({ kind: 'running' });
    setLive(null);
    let running = true;
    void (async () => {
      while (running && mounted.current) {
        const fresh = await getProposal(config.rpcUrl, context.contract, proposalId).catch(() => null);
        if (fresh && running && mounted.current) setLive(fresh);
        await new Promise((resolve) => setTimeout(resolve, POLL_MS));
      }
    })();
    const answer = await requestApproval(proposalId, opening);
    running = false;
    const done: Finish = { kind: 'done', opening, transactionHash: null };
    if (answer.kind === 'done') {
      if (answer.proposal) setLive(answer.proposal);
      if (answer.executed) {
        removeOpening(context.contract, proposalId);
        setFinish({ ...done, transactionHash: answer.transactionHash });
      } else {
        setFinish({
          kind: 'failed',
          message: isHide(opening)
            ? 'The signers approved, but the notes contract did not hide the note. Finish the proposal tries again.'
            : 'The signers approved, but the transfer did not arrive. The NEAR is back in the multisig. Finish the proposal tries again.',
        });
      }
    } else if (answer.kind === 'executed_before') {
      removeOpening(context.contract, proposalId);
      setFinish(done);
    } else {
      setFinish({ kind: 'failed', message: answer.message });
    }
    context.onSent(proposalId);
  };

  return { finish, live, run };
}

/** One tick of the approval list. */
function Tick({ done, label, detail }: { done: boolean; label: string; detail: ReactNode }) {
  return (
    <li className={done ? 'lms-tick-done' : ''}>
      <span className={`sf-stepdot ${done ? '' : 'sf-stepdot-wait'}`} aria-hidden="true">
        {done && <IconCheck size={12} stroke={3} />}
      </span>
      <span>
        {label}
        <span className="sr-only">{done ? ' (done)' : ' (waiting)'}</span>
        <span className="lms-tick-detail">{detail}</span>
      </span>
    </li>
  );
}

/** The proposer's approval, then one tick for each admin. */
function ApprovalTicks({
  context,
  proposer,
  approvals,
  executed,
  proposeHash,
}: {
  context: MultisigContext;
  proposer: string;
  approvals: string[];
  /** The proposal ran, so every admin approved. */
  executed: boolean;
  proposeHash?: string;
}) {
  const admins = context.config?.admins ?? [];
  return (
    <ul className="lms-ticks">
      <Tick
        done
        label={proposer === context.account ? 'Your approval' : 'Proposer'}
        detail={proposeHash ? <TxLink hash={proposeHash} /> : shortAccount(proposer)}
      />
      {admins.map((admin, index) => (
        <Tick key={admin} done={executed || approvals.includes(admin)} label={adminName(index)} detail={shortAccount(admin)} />
      ))}
    </ul>
  );
}

/** The end of a run: the receipt, the wait, or the failure and **Finish the proposal**. */
function FinishState({
  finish,
  onFinish,
  canFinish,
  kind,
}: {
  finish: Finish;
  onFinish: () => void;
  canFinish: boolean;
  kind: ProposalKind;
}) {
  if (finish.kind === 'done') {
    const { opening } = finish;
    const target = isHide(opening) ? config.contract : opening.receiver;
    return (
      <div className="lms-receipt" role="status">
        <p className="lms-done-title">
          <IconCheck size={16} stroke={3} />{' '}
          {isHide(opening) ? `Note ${opening.note_id} is hidden` : `Sent ${formatYocto(opening.amount_yocto)} NEAR to ${opening.receiver}`}
        </p>
        {isHide(opening) && <p>The notes contract removed its text. It now reads “The moderators hid this note.”</p>}
        <p>
          {finish.transactionHash ? (
            <TxLink hash={finish.transactionHash} />
          ) : (
            <a href={accountUrl(target)} target="_blank" rel="noopener noreferrer">
              See {target} on the explorer <IconExternalLink size={12} stroke={2} />
            </a>
          )}
        </p>
      </div>
    );
  }
  if (finish.kind === 'running') {
    return (
      <p className="lms-hint" role="status">
        Admin A and Admin B approve, then Admin B {kind === 'hide' ? 'hides the note' : 'sends the NEAR'}. This takes a few seconds.
      </p>
    );
  }
  if (finish.kind === 'idle' && !canFinish) {
    return <p className="lms-hint">Only the proposer’s browser holds the opening, so only it can finish the proposal.</p>;
  }
  return (
    <div className="lms-action">
      {finish.kind === 'failed' && (
        <p className="lms-error" role="alert">
          {finish.message}
        </p>
      )}
      {canFinish && (
        <button type="button" className="sf-btn lms-btn" onClick={onFinish}>
          {kind === 'hide' ? <IconEyeOff size={15} stroke={2} /> : <IconSend size={15} stroke={2} />} Finish the proposal
        </button>
      )}
    </div>
  );
}

/** What stops the visitor from proposing, or null. */
function proposeBlock(context: MultisigContext, enrolled: boolean, gasShort: boolean): { text: string; setup: boolean } | null {
  if (context.demo) return { text: DEMO_NOTE, setup: false };
  if (!context.account) return null;
  if (!context.config) return { text: 'The page cannot read the multisig now, so it cannot propose.', setup: false };
  if (context.config?.admins.includes(context.account)) {
    return { text: 'This account is a signer of the multisig, and a signer cannot propose. Sign in with another account.', setup: false };
  }
  if (!enrolled) return { text: 'Set up your voice first. The Set up card on this page does it.', setup: true };
  if (gasShort) {
    return { text: 'This account needs testnet NEAR for gas. The Set up card on this page gets it from the faucet.', setup: true };
  }
  return null;
}

/** The reported practice notes that are not hidden, newest first, from the notes contract. */
function usePracticeNotes(): { notes: Note[] | null; error: string | null; reload: () => void } {
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(() => {
    new RpcNotesStore(config.rpcUrl, config.contract)
      .getNotes(PRACTICE_POST_ID)
      .then((all) => {
        setNotes(all.filter((note) => !note.hidden && note.text !== ''));
        setError(null);
      })
      .catch((cause: unknown) => setError(`The page cannot read the reported notes: ${cause instanceof Error ? cause.message : 'unknown error'}`));
  }, []);
  useEffect(reload, [reload]);
  return { notes, error, reload };
}

/** How many reported notes the form lists. */
const NOTES_SHOWN = 4;

/** The reported notes, one to pick. */
function ReportedNotes({
  notes,
  error,
  noteId,
  onPick,
  disabled,
}: {
  notes: Note[] | null;
  error: string | null;
  noteId: number | null;
  onPick: (noteId: number) => void;
  disabled: boolean;
}) {
  if (error) return <p className="lms-error">{error}</p>;
  if (!notes) return <p className="lms-hint">Reading the reported notes…</p>;
  if (notes.length === 0) return <p className="lms-hint">No reported note waits now. Try the transfer, or come back later.</p>;
  return (
    <fieldset className="lms-notes" disabled={disabled}>
      <legend className="sf-label">Reported notes · pick one to hide</legend>
      {notes.slice(0, NOTES_SHOWN).map((note) => (
        <label key={note.id} className={`lms-report ${note.id === noteId ? 'lms-report-on' : ''}`}>
          <input type="radio" name="hide-note" checked={note.id === noteId} onChange={() => onPick(note.id)} />
          <span>
            <b>Note {note.id}</b>
            <span className="lms-report-text">{note.text}</span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}

/**
 * The proposal form. The visitor picks a reported note to hide, or types a transfer, and reads
 * the proposal aloud.
 */
export function ProposePanel({ context, proposalId }: { context: MultisigContext; proposalId: number | null }) {
  const [kind, setKind] = useState<ProposalKind>('hide');
  const [receiver, setReceiver] = useState(DEFAULT_RECEIVER);
  const [amountText, setAmountText] = useState(DEFAULT_AMOUNT);
  const [picked, setPicked] = useState<number | null>(null);
  const [voice, setVoice] = useState<VoiceStep>({ kind: 'idle' });
  const [proposed, setProposed] = useState<{ id: number; transactionHash: string; opening: Opening; stored: boolean } | null>(null);
  const run = useFinish(context);
  const enrolled = useEnrolled(context.account);
  const funds = useFunds(context.account, false);
  const reported = usePracticeNotes();

  // The picked note, or the newest reported note.
  const noteId = reported.notes?.some((note) => note.id === picked) ? picked : (reported.notes?.[0]?.id ?? null);
  const amount = parseNearAmount(amountText);
  const receiverOk = isSpeakableAccount(receiver.trim());
  const ready = proposalId !== null && (kind === 'hide' ? noteId !== null : amount.ok && receiverOk);
  const display = amount.ok ? formatNear(amount.hundredths) : '';
  const block = proposeBlock(context, enrolled, funds.balance !== null && !covers(funds.balance, 'gas'));
  const busy = BUSY[voice.kind] ?? null;

  const onRecorded = async (wav: Uint8Array) => {
    if (!context.account || !ready || proposalId === null) return;
    const id = proposalId;
    const to = receiver.trim();
    if (kind === 'transfer' && !amount.ok) return;
    if (kind === 'hide' && noteId === null) return;
    setVoice({ kind: 'checking' });
    const check = await checkVoice(
      context.account,
      kind === 'hide' && noteId !== null
        ? { kind: 'multisig_hide_note', multisig: context.contract, proposal_id: id, note_id: noteId }
        : { kind: 'multisig_propose', multisig: context.contract, proposal_id: id, receiver: to, amount_yocto: amount.ok ? amount.yocto : '' },
      wav,
    );
    if (check.kind !== 'accepted') {
      setVoice({ kind: 'failed', message: check.reason, heard: check.kind === 'refused' ? check.heard : undefined });
      return;
    }
    // Keep the opening before the Wallet step: without it the proposal can never execute.
    const opening: Opening =
      kind === 'hide' && noteId !== null
        ? { note_id: noteId, salt_hex: check.saltHex, commitment_hex: check.commitmentHex }
        : { receiver: to, amount_yocto: amount.ok ? amount.yocto : '', salt_hex: check.saltHex, commitment_hex: check.commitmentHex };
    const stored = writeOpening(context.contract, id, opening);
    setVoice({ kind: 'signing' });
    const result = await context.signer.propose({
      proposalId: id,
      commitmentHex: check.commitmentHex,
      verdictJson: check.verdictJson,
      signatureB64: check.signatureB64,
    });
    if (result.kind !== 'sent') {
      setVoice({ kind: 'failed', message: signFailure(result) });
      return;
    }
    setVoice({ kind: 'idle' });
    setProposed({ id, transactionHash: result.transactionHash, opening, stored });
    void run.run(id, opening).then(reported.reload);
  };

  if (proposed) {
    const { finish, live } = run;
    const proposedKind = kindOf(proposed.opening);
    return (
      <div className="lms-panel">
        <p className="lms-done-title">
          Proposal {proposed.id}
          {isHide(proposed.opening) ? `: hide note ${proposed.opening.note_id}` : ''}
        </p>
        <ApprovalTicks
          context={context}
          proposer={context.account ?? ''}
          approvals={live?.id === proposed.id ? live.approvals : []}
          executed={finish.kind === 'done'}
          proposeHash={proposed.transactionHash}
        />
        {!proposed.stored && finish.kind !== 'done' && (
          <p className="lms-hint">This browser could not store the opening, so Finish the proposal works only until you close this page.</p>
        )}
        <FinishState finish={finish} canFinish kind={proposedKind} onFinish={() => void run.run(proposed.id, proposed.opening)} />
        {finish.kind !== 'running' && (
          <button
            type="button"
            className="sf-btn sf-btn-ghost lms-btn"
            onClick={() => {
              setProposed(null);
              setVoice({ kind: 'idle' });
              reported.reload();
            }}
          >
            New proposal
          </button>
        )}
      </div>
    );
  }

  const locked = busy !== null;
  return (
    <div className="lms-panel">
      <div className="lms-kinds" role="radiogroup" aria-label="Proposal">
        {(['hide', 'transfer'] as const).map((option) => (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={kind === option}
            className={kind === option ? 'lms-kind-on' : ''}
            onClick={() => {
              setKind(option);
              setVoice({ kind: 'idle' });
            }}
            disabled={locked}
          >
            {option === 'hide' ? <IconEyeOff size={15} stroke={2} /> : <IconSend size={15} stroke={2} />}
            {option === 'hide' ? 'Hide a note' : 'Send NEAR'}
          </button>
        ))}
      </div>
      {kind === 'hide' ? (
        <ReportedNotes notes={reported.notes} error={reported.error} noteId={noteId} onPick={setPicked} disabled={locked} />
      ) : (
        <div className="lms-fields">
          <label className="lms-field">
            <span>Send to</span>
            <input
              value={receiver}
              onChange={(event) => setReceiver(event.target.value.toLowerCase())}
              placeholder={DEFAULT_RECEIVER}
              spellCheck={false}
              autoComplete="off"
              disabled={locked}
            />
            {receiver.trim() !== '' && !receiverOk && <em>A named NEAR account, for example {DEFAULT_RECEIVER}.</em>}
          </label>
          <label className="lms-field lms-field-amount">
            <span>Amount (NEAR)</span>
            <input value={amountText} onChange={(event) => setAmountText(event.target.value)} placeholder={DEFAULT_AMOUNT} inputMode="decimal" disabled={locked} />
            {amountText.trim() !== '' && !amount.ok && <em>{amount.error}</em>}
          </label>
        </div>
      )}
      <p className="sf-label">Read this aloud</p>
      <p className={`lms-say ${ready ? '' : 'lms-say-empty'}`}>
        {kind === 'hide'
          ? ready && noteId !== null
            ? hideSentence(proposalId, noteId)
            : `Approve proposal ${proposalId ?? '…'}: hide note …`
          : ready
            ? proposalSentence(proposalId, display, receiver.trim())
            : `Approve proposal ${proposalId ?? '…'}: send … NEAR to …`}
      </p>
      <p className="lms-hint">
        {kind === 'hide'
          ? 'Readers reported these practice notes. The admins hide only them, not the real notes. The chain gets only a hash of the proposal until it runs.'
          : 'You can say “dot” or “point”, and you can leave out “dash”. The verifier keeps the transfer; the chain gets only its hash.'}
      </p>
      {!context.account && !context.demo ? (
        <button type="button" className="sf-btn lms-btn" onClick={context.onSignIn} disabled={!context.onSignIn}>
          Sign in to propose
        </button>
      ) : block ? (
        <div className="lms-action">
          <p className="lms-hint">{block.text}</p>
          {block.setup && (
            <a className="sf-btn sf-btn-ghost lms-btn lms-btn-sm" href="#setup">
              Go to Set up
            </a>
          )}
        </div>
      ) : (
        <VoiceRecorder disabled={!ready} busy={busy} onRecorded={(wav) => void onRecorded(wav)} />
      )}
      <VoiceMessage step={voice} />
    </div>
  );
}

/** The status line of a proposal. */
export function proposalStatus(proposal: Proposal, adminCount: number): { text: string; tone: 'wait' | 'ready' | 'done' } {
  if (proposal.status === 'executed') return { text: 'Executed', tone: 'done' };
  return proposal.approvals.length >= adminCount ? { text: 'Approved', tone: 'ready' } : { text: 'Needs approvals', tone: 'wait' };
}

/** What a proposal does, if this page knows it. */
export type KnownProposal = { kind: 'transfer'; receiver: string; amount: string } | { kind: 'hide'; noteId: number };

/** The proposal, if this page knows it: after execute, or from this browser's opening. */
export function knownProposal(contract: string, proposal: Proposal): KnownProposal | null {
  if (proposal.receiver && proposal.amount_yocto) {
    return { kind: 'transfer', receiver: proposal.receiver, amount: formatYocto(proposal.amount_yocto) };
  }
  if (proposal.note_id) return { kind: 'hide', noteId: proposal.note_id };
  const opening = readOpening(contract, proposal.id);
  if (opening && opening.commitment_hex === proposal.commitment_hex) {
    return isHide(opening)
      ? { kind: 'hide', noteId: opening.note_id }
      : { kind: 'transfer', receiver: opening.receiver, amount: formatYocto(opening.amount_yocto) };
  }
  return null;
}

/** The body of an open proposal in the history: what it does, the approvals and **Finish the proposal**. */
export function ProposalBody({ context, proposal }: { context: MultisigContext; proposal: Proposal }) {
  const transfer = useFinish(context);
  const shown = transfer.live?.id === proposal.id ? transfer.live : proposal;
  const known = knownProposal(context.contract, shown);
  const opening = readOpening(context.contract, proposal.id);
  const canFinish = !context.demo && shown.status === 'open' && opening?.commitment_hex === proposal.commitment_hex;

  return (
    <div className="sf-txbody">
      <div className="sf-details">
        {known?.kind === 'hide' ? (
          <p>
            Hide <b>note {known.noteId}</b>
          </p>
        ) : known ? (
          <p>
            Send <b>{known.amount} NEAR</b> to <b>{known.receiver}</b>
          </p>
        ) : (
          <p>
            Proposal <span className="sf-muted">· what it does is hidden until executed</span>
          </p>
        )}
        <p className="lms-hint">
          {known
            ? 'This browser holds the opening of this proposal.'
            : 'The chain holds only a salted hash of the proposal. The proposer’s browser holds the opening.'}
        </p>
        <dl>
          <dt>Proposal</dt>
          <dd>{proposal.id}</dd>
          <dt>Proposer</dt>
          <dd>{shortAccount(proposal.proposer)}</dd>
          <dt>Proposed</dt>
          <dd>{new Date(proposal.created_at_ms).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}</dd>
          <dt>Commitment</dt>
          <dd title={proposal.commitment_hex}>{`${proposal.commitment_hex.slice(0, 10)}…${proposal.commitment_hex.slice(-6)}`}</dd>
        </dl>
      </div>
      <div className="sf-steps">
        <ApprovalTicks context={context} proposer={proposal.proposer} approvals={shown.approvals} executed={transfer.finish.kind === 'done'} />
        {context.demo ? (
          <p className="lms-hint">{DEMO_NOTE}</p>
        ) : (
          <FinishState
            finish={transfer.finish}
            canFinish={canFinish}
            kind={opening && isHide(opening) ? 'hide' : 'transfer'}
            onFinish={() => void transfer.run(proposal.id)}
          />
        )}
      </div>
    </div>
  );
}
