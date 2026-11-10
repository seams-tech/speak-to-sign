// The two working parts of the multisig screen: the proposal form and a queued proposal. The
// visitor reads the transfer aloud: the page records it, asks /api/voice-verify, and on an accept
// signs `propose` with the Seams Wallet. Then the page sends the opening to /api/multisig/approve:
// the two admin signers approve, and admin B executes. The page shows three ticks (the voice
// approval, admin A, admin B) and the receipt. Until the transfer is executed, this browser keeps
// the opening, and **Finish the transfer** calls the route again.

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { IconCheck, IconExternalLink, IconSend } from '@tabler/icons-react';
import { accountUrl, config, shortAccount, shortHash, transactionUrl } from '../config';
import { covers, useFunds } from '../faucet/funds';
import type { SignResult } from '../signer/notesSigner';
import { useEnrolled } from '../signer/voiceSetup';
import { requestApproval } from './approveClient';
import { formatNear, formatYocto, isSpeakableAccount, parseNearAmount, proposalSentence } from './intent';
import type { MultisigSigner } from './multisigSigner';
import { readOpening, removeOpening, writeOpening, type Opening } from './openings';
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

export const ADMINS_NOTE = 'The two admin signers approve automatically in this demo.';
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
  | { kind: 'done'; receiver: string; amountYocto: string; transactionHash: string | null }
  | { kind: 'failed'; message: string };

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
      setFinish({ kind: 'failed', message: 'This browser has no opening for this proposal, so it cannot finish the transfer.' });
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
    const done: Finish = { kind: 'done', receiver: opening.receiver, amountYocto: opening.amount_yocto, transactionHash: null };
    if (answer.kind === 'done') {
      if (answer.proposal) setLive(answer.proposal);
      if (answer.executed) {
        removeOpening(context.contract, proposalId);
        setFinish({ ...done, transactionHash: answer.transactionHash });
      } else {
        setFinish({
          kind: 'failed',
          message: 'The admins approved, but the transfer did not arrive. The NEAR is back in the multisig. Finish the transfer tries again.',
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

/** The voice approval, then one tick for each admin. */
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
  /** The transfer is done, so every admin approved. */
  executed: boolean;
  proposeHash?: string;
}) {
  const admins = context.config?.admins ?? [];
  return (
    <ul className="lms-ticks">
      <Tick
        done
        label={proposer === context.account ? 'Your voice approval' : 'Voice approval'}
        detail={proposeHash ? <TxLink hash={proposeHash} /> : shortAccount(proposer)}
      />
      {admins.map((admin, index) => (
        <Tick key={admin} done={executed || approvals.includes(admin)} label={adminName(index)} detail={shortAccount(admin)} />
      ))}
    </ul>
  );
}

/** The end of a run: the receipt, the wait, or the failure and **Finish the transfer**. */
function FinishState({ finish, onFinish, canFinish }: { finish: Finish; onFinish: () => void; canFinish: boolean }) {
  if (finish.kind === 'done') {
    return (
      <div className="lms-receipt" role="status">
        <p className="lms-done-title">
          <IconCheck size={16} stroke={3} /> Sent {formatYocto(finish.amountYocto)} NEAR to {finish.receiver}
        </p>
        <p>
          {finish.transactionHash ? (
            <TxLink hash={finish.transactionHash} />
          ) : (
            <a href={accountUrl(finish.receiver)} target="_blank" rel="noopener noreferrer">
              See {finish.receiver} on the explorer <IconExternalLink size={12} stroke={2} />
            </a>
          )}
        </p>
      </div>
    );
  }
  if (finish.kind === 'running') {
    return (
      <p className="lms-hint" role="status">
        The admins approve, then admin B sends the NEAR. This takes a few seconds.
      </p>
    );
  }
  if (finish.kind === 'idle' && !canFinish) {
    return <p className="lms-hint">Only the proposer’s browser holds the opening, so only it can finish the transfer.</p>;
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
          <IconSend size={15} stroke={2} /> Finish the transfer
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
    return { text: 'This account is an admin of the multisig, and admins cannot propose. Sign in with another account.', setup: false };
  }
  if (!enrolled) return { text: 'Set up your voice first. The Set up card on this page does it.', setup: true };
  if (gasShort) {
    return { text: 'This account needs testnet NEAR for gas. The Set up card on this page gets it from the faucet.', setup: true };
  }
  return null;
}

/** The proposal form. The visitor types the transfer and reads it aloud. */
export function ProposePanel({ context, proposalId }: { context: MultisigContext; proposalId: number | null }) {
  const [receiver, setReceiver] = useState(DEFAULT_RECEIVER);
  const [amountText, setAmountText] = useState(DEFAULT_AMOUNT);
  const [voice, setVoice] = useState<VoiceStep>({ kind: 'idle' });
  const [proposed, setProposed] = useState<{ id: number; transactionHash: string; opening: Opening; stored: boolean } | null>(null);
  const transfer = useFinish(context);
  const enrolled = useEnrolled(context.account);
  const funds = useFunds(context.account, false);

  const cap = context.config?.max_amount_yocto ?? null;
  const amount = parseNearAmount(amountText);
  const overCap = amount.ok && cap !== null && BigInt(amount.yocto) > BigInt(cap);
  const receiverOk = isSpeakableAccount(receiver.trim());
  const ready = amount.ok && !overCap && receiverOk && proposalId !== null;
  const display = amount.ok ? formatNear(amount.hundredths) : '';
  const block = proposeBlock(context, enrolled, funds.balance !== null && !covers(funds.balance, 'gas'));
  const busy = BUSY[voice.kind] ?? null;

  const onRecorded = async (wav: Uint8Array) => {
    if (!context.account || !ready || !amount.ok) return;
    const id = proposalId;
    const to = receiver.trim();
    setVoice({ kind: 'checking' });
    const check = await checkVoice(
      context.account,
      { kind: 'multisig_propose', multisig: context.contract, proposal_id: id, receiver: to, amount_yocto: amount.yocto },
      wav,
    );
    if (check.kind !== 'accepted') {
      setVoice({ kind: 'failed', message: check.reason, heard: check.kind === 'refused' ? check.heard : undefined });
      return;
    }
    // Keep the opening before the Wallet step: without it the proposal can never execute.
    const opening: Opening = { receiver: to, amount_yocto: amount.yocto, salt_hex: check.saltHex, commitment_hex: check.commitmentHex };
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
    void transfer.run(id, opening);
  };

  if (proposed) {
    const { finish, live } = transfer;
    return (
      <div className="lms-panel">
        <p className="lms-done-title">Proposal {proposed.id}</p>
        <ApprovalTicks
          context={context}
          proposer={context.account ?? ''}
          approvals={live?.id === proposed.id ? live.approvals : []}
          executed={finish.kind === 'done'}
          proposeHash={proposed.transactionHash}
        />
        <p className="lms-hint">{ADMINS_NOTE}</p>
        {!proposed.stored && finish.kind !== 'done' && (
          <p className="lms-hint">This browser could not store the opening, so Finish the transfer works only until you close this page.</p>
        )}
        <FinishState finish={finish} canFinish onFinish={() => void transfer.run(proposed.id, proposed.opening)} />
        {finish.kind !== 'running' && (
          <button
            type="button"
            className="sf-btn sf-btn-ghost lms-btn"
            onClick={() => {
              setProposed(null);
              setVoice({ kind: 'idle' });
            }}
          >
            New proposal
          </button>
        )}
      </div>
    );
  }

  const locked = busy !== null;
  const capText = cap === null ? null : formatYocto(cap);
  return (
    <div className="lms-panel">
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
          {amountText.trim() !== '' && !amount.ok ? (
            <em>{amount.error}</em>
          ) : overCap ? (
            <em>The most for one proposal is {capText} NEAR.</em>
          ) : (
            capText && <small>At most {capText} NEAR</small>
          )}
        </label>
      </div>
      <p className="sf-label">Read this aloud</p>
      <p className={`lms-say ${ready ? '' : 'lms-say-empty'}`}>
        {ready ? proposalSentence(proposalId, display, receiver.trim()) : `Approve proposal ${proposalId ?? '…'}: send … NEAR to …`}
      </p>
      <p className="lms-hint">
        Say “dot” for each dot and “dash” for each dash of the account. The verifier keeps the transfer; the chain gets only its hash.
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

/** The transfer of a proposal, if this page knows it: after execute, or from this browser's opening. */
export function knownTransfer(contract: string, proposal: Proposal): { receiver: string; amount: string } | null {
  if (proposal.receiver && proposal.amount_yocto) return { receiver: proposal.receiver, amount: formatYocto(proposal.amount_yocto) };
  const opening = readOpening(contract, proposal.id);
  if (opening && opening.commitment_hex === proposal.commitment_hex) {
    return { receiver: opening.receiver, amount: formatYocto(opening.amount_yocto) };
  }
  return null;
}

/** The body of an open queued proposal: the transfer, the approvals and **Finish the transfer**. */
export function ProposalBody({ context, proposal }: { context: MultisigContext; proposal: Proposal }) {
  const transfer = useFinish(context);
  const shown = transfer.live?.id === proposal.id ? transfer.live : proposal;
  const known = knownTransfer(context.contract, shown);
  const opening = readOpening(context.contract, proposal.id);
  const canFinish = !context.demo && shown.status === 'open' && opening?.commitment_hex === proposal.commitment_hex;

  return (
    <div className="sf-txbody">
      <div className="sf-details">
        {known ? (
          <p>
            Send <b>{known.amount} NEAR</b> to <b>{known.receiver}</b>
          </p>
        ) : (
          <p>
            Send NEAR <span className="sf-muted">· the amount and the receiver are hidden until executed</span>
          </p>
        )}
        <p className="lms-hint">
          {known
            ? 'This browser holds the opening of this proposal.'
            : 'The chain holds only a salted hash of the transfer. The proposer’s browser holds the opening.'}
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
        <p className="lms-hint">{ADMINS_NOTE}</p>
        {context.demo ? (
          <p className="lms-hint">{DEMO_NOTE}</p>
        ) : (
          <FinishState finish={transfer.finish} canFinish={canFinish} onFinish={() => void transfer.run(proposal.id)} />
        )}
      </div>
    </div>
  );
}
