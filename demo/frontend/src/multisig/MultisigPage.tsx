// The spoken multisig page (/multisig/): a live voice multisig, version 3.0.0, on NEAR testnet
// (demo/contracts/voice-multisig, docs/voice-intents-spec.md section 10).
//
// - A signer proposes a transfer: the signer types it, then reads it aloud. The verifier checks
//   the voice and the words, keeps the proposal and its salt, and signs a verdict; the Seams
//   Wallet signs `propose` with that verdict. The chain gets only a salted hash of the proposal.
//   This browser keeps the opening (the transfer and the salt) for `execute`.
// - Each other signer says the proposal from memory: the proposer tells it off chain, and this
//   page never shows it to another browser. The verifier loads the stored proposal by its
//   commitment, checks the voice and the words, and refuses a voice that matches a signer who
//   already said it (`same_speaker`). The Wallet signs `approve` with that verdict.
// - At the threshold, the proposer's browser signs `execute` with the opening, and the NEAR moves.
//
// A refused verdict is signed too. The page can send it to `approve` as a record: the contract
// refuses it ("the verdict outcome must be accept"), and the failed transaction holds the signed
// refusal and its reason. The page has the light theme only.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { IconCheck, IconCircleDashed, IconExternalLink, IconSend } from '@tabler/icons-react';
import { useSeams } from '@seams/wallet/react';
import { BrandMark } from '../components/BrandMark';
import { SignInModal } from '../components/SignInModal';
import { accountUrl, config, shortAccount, shortHash, transactionUrl } from '../config';
import { KeylessOnboarding, SeamsOnboarding } from '../showcase/Onboarding';
import { SeamsSettingsPill } from '../showcase/SeamsSettingsPill';
import type { MultisigConfig, Proposal } from './contractViews';
import { formatBalance, formatNear, formatYocto, isSpeakableAccount, parseNearAmount, proposalSentence } from './intent';
import { createMultisigSigner, type MultisigSigner, type SendResult } from './multisigSigner';
import { readOpening, removeOpening, writeOpening, type Opening } from './openings';
import { getBalance, getConfig, getProposal, getProposals, nextProposalId } from './views';
import { checkVoice, type SignedVerdict, type VoiceCheck } from './voiceVerify';
import { VoiceRecorder } from './VoiceRecorder';
import './multisig.css';

const POLL_MS = 1500;
const DEFAULT_RECEIVER = 'seams-faucet.testnet';
const DEFAULT_AMOUNT = '0.1';
const NO_WALLET: MultisigSigner = createMultisigSigner({ seams: null, walletId: null, contract: config.multisigContract });

export function MultisigPage({ seams }: { seams: boolean }) {
  const [signIn, setSignIn] = useState(false);
  return (
    <div className="ms-page">
      <header className="ms-nav">
        <a className="ms-brand" href="/">
          <BrandMark size={24} />
          Speak-to-Sign
        </a>
        <span className="ms-nav-gap" />
        {seams && <SeamsSettingsPill onSignIn={() => setSignIn(true)} />}
      </header>
      <main className="ms-main">
        <section className="ms-intro">
          <h1>Spoken multisig</h1>
          <p>
            Each signer approves a transfer by saying it. The verifier checks the voice and the words, and the contract checks the
            verifier’s signed verdict. A changed page cannot change what a signer says, and one voice cannot approve twice.
          </p>
        </section>
        <section className="ms-setup" aria-label="Set up">
          {seams ? <SeamsOnboarding onSignIn={() => setSignIn(true)} /> : <KeylessOnboarding />}
        </section>
        {seams ? <SeamsBoard onSignIn={() => setSignIn(true)} /> : <Board account={undefined} signer={NO_WALLET} />}
      </main>
      {seams && signIn && <SignInModal onClose={() => setSignIn(false)} onSignedIn={() => setSignIn(false)} />}
    </div>
  );
}

function SeamsBoard({ onSignIn }: { onSignIn: () => void }) {
  const { seams, loginState } = useSeams();
  const walletId = loginState.isLoggedIn && loginState.access === 'wallet' ? loginState.walletId : null;
  const account = walletId ? (loginState.nearAccountId ?? undefined) : undefined;
  const signer = useMemo(() => createMultisigSigner({ seams, walletId, contract: config.multisigContract }), [seams, walletId]);
  return <Board account={account} signer={signer} onSignIn={onSignIn} />;
}

interface Loaded {
  config: MultisigConfig | null;
  proposals: Proposal[];
  nextId: number | null;
  balance: string | null;
  error: string | null;
}

/** One transaction that this page sent, for the list under its proposal. */
interface SentTx {
  label: string;
  hash: string;
  failed: boolean;
}

/** What the cards need from the board. */
interface Context {
  contract: string;
  account: string | undefined;
  config: MultisigConfig;
  signer: MultisigSigner;
  /** A transaction went out for this proposal: keep its hash, and read the contract again. */
  onSent: (proposalId: number, tx: SentTx) => void;
}

function Board({ account, signer, onSignIn }: { account: string | undefined; signer: MultisigSigner; onSignIn?: () => void }) {
  const contract = config.multisigContract;
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [sent, setSent] = useState<Record<number, SentTx[]>>({});

  const load = useCallback(async () => {
    const [configResult, proposalsResult, nextResult, balanceResult] = await Promise.allSettled([
      getConfig(config.rpcUrl, contract),
      getProposals(config.rpcUrl, contract),
      nextProposalId(config.rpcUrl, contract),
      getBalance(config.rpcUrl, contract),
    ]);
    const failed = [configResult, proposalsResult, nextResult].find((result) => result.status === 'rejected');
    const error = failed?.status === 'rejected' ? (failed.reason instanceof Error ? failed.reason.message : String(failed.reason)) : null;
    const proposals = proposalsResult.status === 'fulfilled' ? proposalsResult.value : [];
    // The opening is needed only until the transfer is executed.
    for (const proposal of proposals) if (proposal.status === 'executed') removeOpening(contract, proposal.id);
    setLoaded({
      config: configResult.status === 'fulfilled' ? configResult.value : null,
      proposals,
      nextId: nextResult.status === 'fulfilled' ? nextResult.value : null,
      balance: balanceResult.status === 'fulfilled' ? balanceResult.value : null,
      error,
    });
  }, [contract]);

  useEffect(() => {
    void load();
  }, [load]);

  // After a transaction, read the proposal until the contract shows the change. A new proposal
  // is absent before, so any answer is a change.
  const onSent = useCallback(
    (proposalId: number, tx: SentTx) => {
      setSent((all) => ({ ...all, [proposalId]: [...(all[proposalId] ?? []), tx] }));
      const before = JSON.stringify(loaded?.proposals.find((proposal) => proposal.id === proposalId) ?? null);
      void (async () => {
        for (let attempt = 0; attempt < 10 && !tx.failed; attempt += 1) {
          const fresh = await getProposal(config.rpcUrl, contract, proposalId).catch(() => null);
          if (fresh && JSON.stringify(fresh) !== before) break;
          await new Promise((resolve) => setTimeout(resolve, POLL_MS));
        }
        await load();
      })();
    },
    [contract, load, loaded],
  );

  const multisig = loaded?.config ?? null;
  const isSigner = !!account && !!multisig?.signers.includes(account);
  const context: Context | null = multisig ? { contract, account, config: multisig, signer, onSent } : null;

  return (
    <>
      <section className="ms-card ms-summary" aria-label="The multisig">
        <div>
          <p className="ms-label">Multisig</p>
          <a className="ms-account" href={accountUrl(contract)} target="_blank" rel="noopener noreferrer">
            {contract} <IconExternalLink size={13} stroke={2} />
          </a>
        </div>
        <div>
          <p className="ms-label">Balance</p>
          <p className="ms-value">{loaded?.balance ? `${formatBalance(loaded.balance)} NEAR` : '—'}</p>
        </div>
        <div>
          <p className="ms-label">Signers</p>
          {multisig ? (
            <>
              <p className="ms-value">
                {multisig.threshold} of {multisig.signers.length} approve
              </p>
              <ul className="ms-signers">
                {multisig.signers.map((id, index) => (
                  <li key={id}>
                    <span className={`ms-dot ms-dot-${index % 2 === 0 ? 'a' : 'b'}`} aria-hidden="true" />
                    <span title={id}>Signer {String.fromCharCode(65 + index)}</span>{' '}
                    <a href={accountUrl(id)} target="_blank" rel="noopener noreferrer">
                      {shortAccount(id)}
                    </a>
                    {id === account && <b className="ms-you">you</b>}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="ms-value">—</p>
          )}
        </div>
      </section>

      {loaded?.error && (
        <p className="ms-error" role="alert">
          {loaded.error}
        </p>
      )}

      {context && (
        <section className="ms-card" aria-label="New proposal">
          <h2>New proposal</h2>
          {!account ? (
            <div className="ms-action">
              <p className="ms-hint">Sign in with a signer’s wallet to propose or approve.</p>
              {onSignIn && (
                <button type="button" className="ms-btn" onClick={onSignIn}>
                  Sign in
                </button>
              )}
            </div>
          ) : !isSigner ? (
            <p className="ms-hint">This wallet is not a signer of this multisig. Only its signers can propose and approve.</p>
          ) : loaded?.nextId ? (
            <ProposeForm context={context} proposalId={loaded.nextId} />
          ) : (
            <p className="ms-hint">Reading the next proposal id…</p>
          )}
        </section>
      )}

      <section className="ms-list" aria-label="Proposals">
        <h2>Proposals</h2>
        {!loaded ? (
          <p className="ms-hint">Reading the multisig…</p>
        ) : loaded.proposals.length === 0 ? (
          <p className="ms-hint">No proposal yet.</p>
        ) : (
          context &&
          loaded.proposals.map((proposal) => (
            <ProposalCard key={`${proposal.id}:${account ?? ''}`} context={context} proposal={proposal} sent={sent[proposal.id] ?? []} />
          ))
        )}
      </section>
    </>
  );
}

type VoiceStep =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'signing' }
  | { kind: 'refused'; check: Extract<VoiceCheck, { kind: 'refused' }> }
  | { kind: 'failed'; message: string };

const BUSY: Partial<Record<VoiceStep['kind'], string>> = {
  checking: 'Checking your voice…',
  signing: 'Confirm in the Wallet…',
};

/** The words for a Wallet result that sent nothing or failed. Null for `sent`. */
function sendFailure(result: SendResult): string | null {
  if (result.kind === 'sent') return null;
  if (result.kind === 'cancelled') return 'You closed the Wallet. Nothing was signed.';
  return result.reason;
}

function TxLink({ hash, label }: { hash: string; label?: string }) {
  return (
    <a href={transactionUrl(hash)} target="_blank" rel="noopener noreferrer">
      {label ?? 'Tx'} {shortHash(hash)} <IconExternalLink size={12} stroke={2} />
    </a>
  );
}

/** A refusal, a failure, or the two-minute note while the Wallet asks. */
function VoiceMessage({ step }: { step: VoiceStep }) {
  if (step.kind === 'refused') {
    return (
      <div className="ms-error" role="alert">
        <p>
          <b>Refused.</b> {step.check.reason}
        </p>
        {step.check.heard !== undefined && <p>The verifier heard: “{step.check.heard}”.</p>}
      </div>
    );
  }
  if (step.kind === 'failed') {
    return (
      <p className="ms-error" role="alert">
        {step.message}
      </p>
    );
  }
  if (step.kind === 'signing') return <p className="ms-hint">The verdict is valid for two minutes. Confirm the transaction in the Wallet now.</p>;
  return null;
}

/** The proposal form: the signer types a transfer, then reads it aloud. */
function ProposeForm({ context, proposalId }: { context: Context; proposalId: number }) {
  const [receiver, setReceiver] = useState(DEFAULT_RECEIVER);
  const [amountText, setAmountText] = useState(DEFAULT_AMOUNT);
  const [step, setStep] = useState<VoiceStep>({ kind: 'idle' });
  const amount = parseNearAmount(amountText);
  const to = receiver.trim();
  const receiverOk = isSpeakableAccount(to);
  const ready = amount.ok && receiverOk;
  const busy = BUSY[step.kind] ?? null;

  const onRecorded = async (wav: Uint8Array) => {
    const account = context.account;
    if (!account || !amount.ok || !receiverOk) return;
    setStep({ kind: 'checking' });
    const check = await checkVoice(
      account,
      { kind: 'multisig_propose', multisig: context.contract, proposal_id: proposalId, receiver: to, amount_yocto: amount.yocto },
      wav,
    );
    if (check.kind === 'refused') return setStep({ kind: 'refused', check });
    if (check.kind === 'unavailable') return setStep({ kind: 'failed', message: check.reason });
    if (!check.opening) return setStep({ kind: 'failed', message: 'The verifier gave no opening for this proposal.' });
    // Keep the opening before the Wallet step: without it the proposal can never execute.
    const opening: Opening = { receiver: to, amount_yocto: amount.yocto, salt_hex: check.opening.saltHex, commitment_hex: check.opening.commitmentHex };
    const stored = writeOpening(context.contract, proposalId, opening);
    setStep({ kind: 'signing' });
    const result = await context.signer.propose({
      proposalId,
      commitmentHex: opening.commitment_hex,
      verdictJson: check.verdict.verdictJson,
      signatureB64: check.verdict.signatureB64,
    });
    const failure = sendFailure(result);
    if (result.kind === 'sent' || result.kind === 'refused') {
      context.onSent(proposalId, { label: 'Propose', hash: result.transactionHash, failed: result.kind === 'refused' });
    }
    if (failure) return setStep({ kind: 'failed', message: failure });
    setStep(stored ? { kind: 'idle' } : { kind: 'failed', message: 'Proposed. This browser could not store the opening, so it can execute only until you close this page.' });
  };

  const locked = busy !== null;
  return (
    <div className="ms-form">
      <div className="ms-fields">
        <label className="ms-field">
          <span>Send to</span>
          <input
            value={receiver}
            onChange={(event) => setReceiver(event.target.value.toLowerCase())}
            spellCheck={false}
            autoComplete="off"
            disabled={locked}
          />
          {to !== '' && !receiverOk && <em>A named NEAR account, for example {DEFAULT_RECEIVER}.</em>}
        </label>
        <label className="ms-field ms-field-amount">
          <span>Amount (NEAR)</span>
          <input value={amountText} onChange={(event) => setAmountText(event.target.value)} inputMode="decimal" disabled={locked} />
          {amountText.trim() !== '' && !amount.ok && <em>{amount.error}</em>}
        </label>
      </div>
      <p className="ms-label">Read this aloud</p>
      <p className={`ms-say ${ready ? '' : 'ms-say-empty'}`}>
        {ready && amount.ok ? proposalSentence(proposalId, formatNear(amount.hundredths), to) : `Approve proposal ${proposalId}: send … NEAR to …`}
      </p>
      <p className="ms-hint">
        You can say “dot” or “point”, and you can leave out “dash”. The verifier keeps the transfer; the chain gets only its salted hash.
        Then tell the other signers the proposal, for example in a call.
      </p>
      <VoiceRecorder disabled={!ready} busy={busy} onRecorded={(wav) => void onRecorded(wav)} />
      <VoiceMessage step={step} />
    </div>
  );
}

/** What a proposal does, if this page knows it: after execute, or from this browser's opening. */
function knownTransfer(contract: string, proposal: Proposal): { receiver: string; amount: string; opening: Opening | null } | null {
  if (proposal.receiver && proposal.amount_yocto) {
    return { receiver: proposal.receiver, amount: formatYocto(proposal.amount_yocto), opening: null };
  }
  const opening = readOpening(contract, proposal.id);
  if (opening && opening.commitment_hex === proposal.commitment_hex) {
    return { receiver: opening.receiver, amount: formatYocto(opening.amount_yocto), opening };
  }
  return null;
}

function ProposalCard({ context, proposal, sent }: { context: Context; proposal: Proposal; sent: SentTx[] }) {
  const { config: multisig, account } = context;
  const known = knownTransfer(context.contract, proposal);
  const approved = proposal.approvals.length;
  const open = proposal.status === 'open';
  const isSigner = !!account && multisig.signers.includes(account);
  const mayApprove = open && isSigner && !proposal.approvals.includes(account ?? '');
  const mayExecute = open && isSigner && approved >= multisig.threshold;
  const status = !open ? 'Executed' : approved >= multisig.threshold ? 'Approved' : 'Needs approvals';

  return (
    <article className="ms-card ms-proposal">
      <header className="ms-proposal-head">
        <span className="ms-nonce">{proposal.id}</span>
        <span className="ms-proposal-what">
          {known ? (
            <>
              <IconSend size={16} stroke={1.8} /> Send <b>{known.amount} NEAR</b> to <b>{known.receiver}</b>
            </>
          ) : (
            <>
              <IconCircleDashed size={16} stroke={1.8} /> <span className="ms-muted">Hidden: the chain holds only a salted hash until execute</span>
            </>
          )}
        </span>
        <span className={`ms-status ms-status-${!open ? 'done' : approved >= multisig.threshold ? 'ready' : 'wait'}`}>{status}</span>
      </header>
      <ul className="ms-ticks">
        {multisig.signers.map((id, index) => {
          const done = proposal.approvals.includes(id);
          return (
            <li key={id} className={done ? 'ms-tick-done' : ''}>
              <span className="ms-tick" aria-hidden="true">
                {done && <IconCheck size={12} stroke={3} />}
              </span>
              Signer {String.fromCharCode(65 + index)} <span className="ms-muted">{shortAccount(id)}</span>
              {id === proposal.proposer && <span className="ms-muted"> · proposer</span>}
              {id === account && <b className="ms-you">you</b>}
              <span className="sr-only">{done ? ' (approved)' : ' (waiting)'}</span>
            </li>
          );
        })}
      </ul>
      <p className="ms-hint">
        {approved} of {multisig.threshold} approvals · proposed {new Date(proposal.created_at_ms).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}
      </p>
      {mayApprove && <ApproveByVoice context={context} proposal={proposal} />}
      {mayExecute && <ExecuteButton context={context} proposal={proposal} opening={known?.opening ?? null} />}
      {sent.length > 0 && (
        <ul className="ms-sent">
          {sent.map((tx) => (
            <li key={tx.hash} className={tx.failed ? 'ms-sent-failed' : ''}>
              {tx.label}
              {tx.failed ? ' (failed)' : ''}: <TxLink hash={tx.hash} label="" />
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

/** A signer who did not approve yet says the proposal from memory. */
function ApproveByVoice({ context, proposal }: { context: Context; proposal: Proposal }) {
  const [step, setStep] = useState<VoiceStep>({ kind: 'idle' });
  const [record, setRecord] = useState<{ busy: boolean; message: string | null }>({ busy: false, message: null });
  const busy = BUSY[step.kind] ?? null;

  const onRecorded = async (wav: Uint8Array) => {
    const account = context.account;
    if (!account) return;
    setRecord({ busy: false, message: null });
    setStep({ kind: 'checking' });
    const check = await checkVoice(
      account,
      { kind: 'multisig_confirm', multisig: context.contract, proposal_id: proposal.id, commitment_hex: proposal.commitment_hex },
      wav,
    );
    if (check.kind === 'refused') return setStep({ kind: 'refused', check });
    if (check.kind === 'unavailable') return setStep({ kind: 'failed', message: check.reason });
    setStep({ kind: 'signing' });
    const result = await context.signer.approve({ proposalId: proposal.id, verdictJson: check.verdict.verdictJson, signatureB64: check.verdict.signatureB64 });
    if (result.kind === 'sent' || result.kind === 'refused') {
      context.onSent(proposal.id, { label: 'Approve', hash: result.transactionHash, failed: result.kind === 'refused' });
    }
    const failure = sendFailure(result);
    setStep(failure ? { kind: 'failed', message: failure } : { kind: 'idle' });
  };

  /** Sends the signed refusal to `approve`. The contract refuses it, and the failed transaction is the record. */
  const sendRefusal = async (signed: SignedVerdict, code: string) => {
    setRecord({ busy: true, message: null });
    const result = await context.signer.approve({ proposalId: proposal.id, verdictJson: signed.verdictJson, signatureB64: signed.signatureB64 });
    if (result.kind === 'sent' || result.kind === 'refused') {
      context.onSent(proposal.id, { label: `Refused verdict (${code})`, hash: result.transactionHash, failed: result.kind === 'refused' });
    }
    setRecord({ busy: false, message: result.kind === 'refused' ? result.reason : sendFailure(result) });
  };

  const refused = step.kind === 'refused' ? step.check : null;
  return (
    <div className="ms-form ms-approve">
      <p className="ms-label">Approve by voice</p>
      <p className="ms-say ms-say-empty">Approve proposal {proposal.id}: send … NEAR to …</p>
      <p className="ms-hint">
        Say the proposal that the proposer told you. This page does not show it: the chain holds only its salted hash, and the verifier
        accepts only the words of the stored proposal. Three tries with wrong words end your tries for this proposal.
      </p>
      <VoiceRecorder busy={busy} onRecorded={(wav) => void onRecorded(wav)} />
      <VoiceMessage step={step} />
      {refused?.signed && (
        <div className="ms-action">
          <button
            type="button"
            className="ms-btn ms-btn-ghost ms-btn-sm"
            disabled={record.busy}
            onClick={() => refused.signed && void sendRefusal(refused.signed, refused.code)}
          >
            {record.busy ? 'Confirm in the Wallet…' : 'Send this refusal to the contract, as a record'}
          </button>
          {record.message && <p className="ms-hint">{record.message}</p>}
        </div>
      )}
    </div>
  );
}

/** At the threshold, the browser that holds the opening executes the transfer. */
function ExecuteButton({ context, proposal, opening }: { context: Context; proposal: Proposal; opening: Opening | null }) {
  const [state, setState] = useState<{ busy: boolean; message: string | null }>({ busy: false, message: null });
  if (!opening) {
    return <p className="ms-hint">Only the proposer’s browser holds the opening (the transfer and its salt), so only it can execute.</p>;
  }
  const run = async () => {
    setState({ busy: true, message: null });
    const result = await context.signer.execute({ proposalId: proposal.id, receiver: opening.receiver, amountYocto: opening.amount_yocto, saltHex: opening.salt_hex });
    if (result.kind === 'sent' || result.kind === 'refused') {
      context.onSent(proposal.id, { label: 'Execute', hash: result.transactionHash, failed: result.kind === 'refused' });
    }
    setState({ busy: false, message: sendFailure(result) });
  };
  return (
    <div className="ms-action">
      <button type="button" className="ms-btn" disabled={state.busy} onClick={() => void run()}>
        <IconSend size={15} stroke={2} /> {state.busy ? 'Confirm in the Wallet…' : `Execute: send ${formatYocto(opening.amount_yocto)} NEAR to ${opening.receiver}`}
      </button>
      {state.message && (
        <p className="ms-error" role="alert">
          {state.message}
        </p>
      )}
    </div>
  );
}
