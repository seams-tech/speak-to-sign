// The two working parts of the multisig screen: the proposal form (the proposer reads the
// transfer aloud) and a queued proposal (a member says it from memory, then the proposer
// executes it). Each spoken step records in the page, asks /api/voice-verify, and on an accept
// signs the contract call with the Seams Wallet.

import { useState } from 'react';
import { IconCheck, IconExternalLink, IconSend } from '@tabler/icons-react';
import { shortAccount, shortHash, transactionUrl } from '../config';
import type { SignResult } from '../signer/notesSigner';
import { formatNear, formatYocto, isSpeakableAccount, parseNearAmount, proposalSentence, transferText } from './intent';
import type { MultisigSigner } from './multisigSigner';
import { readOpening, writeOpening } from './openings';
import type { MultisigConfig, Proposal } from './views';
import { checkVoice, type MultisigVoiceRequest } from './voiceVerify';
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

type Step =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'signing' }
  | { kind: 'done'; transactionHash: string }
  | { kind: 'failed'; message: string; heard?: string };

const BUSY: Partial<Record<Step['kind'], string>> = {
  checking: 'Checking your voice…',
  signing: 'Confirm in the Wallet…',
};

/** Runs one spoken step: the voice check, then the Wallet call. */
function useVoiceStep() {
  const [step, setStep] = useState<Step>({ kind: 'idle' });
  const run = async (
    owner: string,
    request: MultisigVoiceRequest,
    wav: Uint8Array,
    sign: (check: { verdictJson: string; signatureB64: string; commitmentHex?: string; saltHex?: string }) => Promise<SignResult>,
  ): Promise<boolean> => {
    setStep({ kind: 'checking' });
    const check = await checkVoice(owner, request, wav);
    if (check.kind !== 'accepted') {
      setStep({ kind: 'failed', message: check.reason, heard: check.kind === 'refused' ? check.heard : undefined });
      return false;
    }
    setStep({ kind: 'signing' });
    return finish(await sign(check));
  };
  const finish = (result: SignResult): boolean => {
    if (result.kind === 'sent') {
      setStep({ kind: 'done', transactionHash: result.transactionHash });
      return true;
    }
    setStep({ kind: 'failed', message: result.kind === 'cancelled' ? 'You closed the Wallet. Nothing was signed.' : result.reason });
    return false;
  };
  return { step, setStep, run, finish, busy: BUSY[step.kind] ?? null };
}

function StepMessage({ step }: { step: Step }) {
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

const DEMO_NOTE = 'Contract not deployed yet. This is example data, so nothing records or signs.';

function memberNote(context: MultisigContext): string | null {
  if (context.demo) return DEMO_NOTE;
  if (!context.account || !context.config) return null;
  return context.config.members.includes(context.account) ? null : 'Your account is not a member of this multisig.';
}

/** The proposal form. The proposer types the transfer and reads it aloud. */
export function ProposePanel({ context, proposalId }: { context: MultisigContext; proposalId: number | null }) {
  const [receiver, setReceiver] = useState('');
  const [amountText, setAmountText] = useState('');
  const [sent, setSent] = useState<{ id: number; text: string; stored: boolean } | null>(null);
  const voice = useVoiceStep();

  const amount = parseNearAmount(amountText);
  const receiverOk = isSpeakableAccount(receiver.trim());
  const ready = amount.ok && receiverOk && proposalId !== null;
  const display = amount.ok ? formatNear(amount.hundredths) : '';
  const notMember = memberNote(context);

  const onRecorded = async (wav: Uint8Array) => {
    if (!context.account || !ready || !amount.ok) return;
    const id = proposalId;
    const to = receiver.trim();
    let stored = true;
    const ok = await voice.run(
      context.account,
      { kind: 'multisig_propose', multisig: context.contract, proposal_id: id, receiver: to, amount_yocto: amount.yocto },
      wav,
      async ({ verdictJson, signatureB64, commitmentHex = '', saltHex = '' }) => {
        // Keep the opening before the Wallet step: without it the proposal can never execute.
        stored = writeOpening(context.contract, id, { receiver: to, amount_yocto: amount.yocto, salt_hex: saltHex, commitment_hex: commitmentHex });
        return context.signer.propose({ proposalId: id, commitmentHex, verdictJson, signatureB64 });
      },
    );
    if (ok) {
      setSent({ id, text: transferText(display, to), stored });
      context.onSent(id);
    }
  };

  if (sent && voice.step.kind === 'done') {
    return (
      <div className="lms-panel lms-done" role="status">
        <p className="lms-done-title">
          <IconCheck size={16} stroke={3} /> Proposal {sent.id} is on chain. <TxLink hash={voice.step.transactionHash} />
        </p>
        <p>Tell the other members:</p>
        <p className="lms-say">{sent.text}</p>
        <p className="lms-hint">
          The chain holds only a salted hash of it. Each member must say it from memory to approve.
          {sent.stored
            ? ' This browser keeps the salt, so you can execute the proposal here at the threshold.'
            : ' This browser did not store the salt, so nobody can execute this proposal.'}
        </p>
        <button
          type="button"
          className="sf-btn sf-btn-ghost lms-btn"
          onClick={() => {
            setSent(null);
            setReceiver('');
            setAmountText('');
            voice.setStep({ kind: 'idle' });
          }}
        >
          New proposal
        </button>
      </div>
    );
  }

  const locked = voice.busy !== null;
  return (
    <div className="lms-panel">
      <div className="lms-fields">
        <label className="lms-field">
          <span>Send to</span>
          <input
            value={receiver}
            onChange={(event) => setReceiver(event.target.value.toLowerCase())}
            placeholder="grants.testnet"
            spellCheck={false}
            autoComplete="off"
            disabled={locked}
          />
          {receiver.trim() !== '' && !receiverOk && <em>A named NEAR account, for example grants.testnet.</em>}
        </label>
        <label className="lms-field lms-field-amount">
          <span>Amount (NEAR)</span>
          <input value={amountText} onChange={(event) => setAmountText(event.target.value)} placeholder="25" inputMode="decimal" disabled={locked} />
          {amountText.trim() !== '' && !amount.ok && <em>{amount.error}</em>}
        </label>
      </div>
      <p className="sf-label">Read this aloud</p>
      <p className={`lms-say ${ready ? '' : 'lms-say-empty'}`}>
        {ready ? proposalSentence(proposalId, display, receiver.trim()) : `Approve proposal ${proposalId ?? '…'}: send … NEAR to …`}
      </p>
      <p className="lms-hint">Say “dot” for each dot of the account. The verifier keeps the transfer; the chain gets only its hash.</p>
      {!context.account && !context.demo ? (
        <button type="button" className="sf-btn lms-btn" onClick={context.onSignIn} disabled={!context.onSignIn}>
          Sign in to propose
        </button>
      ) : notMember ? (
        <p className="lms-hint">{notMember}</p>
      ) : (
        <VoiceRecorder disabled={!ready} busy={voice.busy} onRecorded={(wav) => void onRecorded(wav)} />
      )}
      <StepMessage step={voice.step} />
    </div>
  );
}

/** The status line of a proposal. */
export function proposalStatus(proposal: Proposal, threshold: number): { text: string; tone: 'wait' | 'ready' | 'done' } {
  if (proposal.status === 'executed') return { text: 'Executed', tone: 'done' };
  if (proposal.status !== 'open') return { text: proposal.status, tone: 'wait' };
  return proposal.confirmations.length >= threshold ? { text: 'Ready to execute', tone: 'ready' } : { text: 'Needs confirmations', tone: 'wait' };
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

/** The body of an open queued proposal: the confirmations and the member's next step. */
export function ProposalBody({ context, proposal }: { context: MultisigContext; proposal: Proposal }) {
  const voice = useVoiceStep();
  const threshold = context.config?.threshold ?? 0;
  const members = context.config?.members ?? proposal.confirmations;
  const transfer = knownTransfer(context.contract, proposal);
  const confirmed = context.account ? proposal.confirmations.includes(context.account) : false;

  const onRecorded = async (wav: Uint8Array) => {
    if (!context.account) return;
    const ok = await voice.run(
      context.account,
      { kind: 'multisig_confirm', multisig: context.contract, proposal_id: proposal.id, commitment_hex: proposal.commitment_hex },
      wav,
      ({ verdictJson, signatureB64 }) => context.signer.confirm({ proposalId: proposal.id, verdictJson, signatureB64 }),
    );
    if (ok) context.onSent(proposal.id);
  };

  const execute = async () => {
    const opening = readOpening(context.contract, proposal.id);
    if (!opening || opening.commitment_hex !== proposal.commitment_hex) {
      voice.setStep({ kind: 'failed', message: 'This browser has no opening for this proposal.' });
      return;
    }
    voice.setStep({ kind: 'signing' });
    const ok = voice.finish(
      await context.signer.execute({
        proposalId: proposal.id,
        receiver: opening.receiver,
        amountYocto: opening.amount_yocto,
        saltHex: opening.salt_hex,
      }),
    );
    if (ok) context.onSent(proposal.id);
  };

  return (
    <div className="sf-txbody">
      <div className="sf-details">
        {transfer ? (
          <p>
            Send <b>{transfer.amount} NEAR</b> to <b>{transfer.receiver}</b>
          </p>
        ) : (
          <p>
            Send <span className="lms-blank">___</span> NEAR to <span className="lms-blank">___</span>
          </p>
        )}
        <p className="lms-hint">
          {transfer
            ? 'This browser holds the opening of this proposal.'
            : 'The transfer is hidden: the chain holds only its salted hash. Each member says it from memory.'}
        </p>
        <dl>
          <dt>Proposal</dt>
          <dd>{proposal.id}</dd>
          <dt>Proposer</dt>
          <dd>{shortAccount(proposal.proposer)}</dd>
          <dt>Commitment</dt>
          <dd title={proposal.commitment_hex}>{`${proposal.commitment_hex.slice(0, 10)}…${proposal.commitment_hex.slice(-6)}`}</dd>
        </dl>
      </div>
      <div className="sf-steps">
        <p className="sf-step sf-step-done">
          <span className="sf-stepdot">
            <IconCheck size={12} stroke={3} />
          </span>
          Proposed
        </p>
        <p className={`sf-step ${proposal.confirmations.length >= threshold ? 'sf-step-done' : ''}`}>
          <span className={`sf-stepdot ${proposal.confirmations.length >= threshold ? '' : 'sf-stepdot-wait'}`}>
            {proposal.confirmations.length >= threshold && <IconCheck size={12} stroke={3} />}
          </span>
          Confirmations{' '}
          <span className="sf-muted">
            ({proposal.confirmations.length} of {threshold})
          </span>
        </p>
        {members.map((member) => (
          <p key={member} className={`sf-owner ${proposal.confirmations.includes(member) ? '' : 'sf-owner-wait'}`}>
            {proposal.confirmations.includes(member) ? <IconCheck size={13} stroke={2.6} className="lms-ok" /> : <span className="lms-dot" />}
            {shortAccount(member)}
            {member === context.account && <span className="sf-muted">(you)</span>}
          </p>
        ))}
        <MemberAction
          context={context}
          proposal={proposal}
          confirmed={confirmed}
          canExecute={transfer !== null && proposal.receiver == null}
          voice={voice}
          onRecorded={(wav) => void onRecorded(wav)}
          onExecute={() => void execute()}
        />
      </div>
    </div>
  );
}

function MemberAction({
  context,
  proposal,
  confirmed,
  canExecute,
  voice,
  onRecorded,
  onExecute,
}: {
  context: MultisigContext;
  proposal: Proposal;
  confirmed: boolean;
  canExecute: boolean;
  voice: ReturnType<typeof useVoiceStep>;
  onRecorded: (wav: Uint8Array) => void;
  onExecute: () => void;
}) {
  const threshold = context.config?.threshold ?? 0;
  const total = context.config?.members.length ?? 0;
  const reached = proposal.confirmations.length >= threshold;

  if (voice.step.kind === 'done') {
    return (
      <p className="lms-ok-line" role="status">
        <IconCheck size={14} stroke={3} /> Sent. <TxLink hash={voice.step.transactionHash} />
      </p>
    );
  }
  if (!context.account && !context.demo) {
    return (
      <button type="button" className="sf-btn lms-btn" onClick={context.onSignIn} disabled={!context.onSignIn}>
        Sign in to confirm
      </button>
    );
  }
  const notMember = memberNote(context);
  if (notMember && !context.demo) return <p className="lms-hint">{notMember}</p>;

  if (!confirmed || context.demo) {
    return (
      <div className="lms-action">
        <p className="sf-label">Say it from memory</p>
        <p className="lms-say">
          Approve proposal {proposal.id}: send <span className="lms-blank">___</span> NEAR to <span className="lms-blank">___</span>
        </p>
        <p className="lms-hint">Say the amount and the receiver that the team agreed. This page does not show them.</p>
        <VoiceRecorder disabled={context.demo} busy={voice.busy} label="Confirm by voice" onRecorded={onRecorded} />
        {context.demo && <p className="lms-hint">{DEMO_NOTE}</p>}
        <StepMessage step={voice.step} />
      </div>
    );
  }
  if (canExecute && reached) {
    return (
      <div className="lms-action">
        <button type="button" className="sf-btn lms-btn" onClick={onExecute} disabled={voice.busy !== null}>
          <IconSend size={15} stroke={2} /> {voice.busy ?? 'Execute'}
        </button>
        <StepMessage step={voice.step} />
      </div>
    );
  }
  return (
    <p className="lms-hint">
      {canExecute
        ? `You confirmed. You can execute it here once ${threshold} of ${total} have confirmed.`
        : `You confirmed. The proposer executes it once ${threshold} of ${total} have confirmed.`}
    </p>
  );
}
