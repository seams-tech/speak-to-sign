import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { IconCheck, IconExternalLink, IconMicrophone } from '@tabler/icons-react';
import { accountUrl, config, shortAccount, transactionUrl } from '../config';
import { useDemo } from '../demoContext';
import { covers, retryFaucet, useFunds, type Funds } from '../faucet/funds';
import { formatNear, formatUsdc } from '../notes/nearAccount';
import type { SetupOutcome, SignerSetup, SignerStatus } from '../signer/notesSigner';
import { setUpVoice, useEnrolled, type VoicePhase } from '../signer/voiceSetup';

export { SETUP_CHANGED } from '../signer/voiceSetup';

/**
 * The line at the top of the notes app: the account, its testnet funds, and the voice. Nothing to
 * set up here: a bet or a note asks for each step when it needs it, and the faucet runs by itself.
 */
export function SetupPanel() {
  const { status, account, walletConfigured, openSignIn } = useDemo();
  const funds = useFunds(account, true);
  const enrolled = useEnrolled(account);
  const voiceOn = !!status?.voiceReady && enrolled;

  return (
    <div className="setup-line">
      <IconMicrophone size={18} stroke={1.8} aria-hidden="true" />
      <span className="setup-line-text">
        <b>Speak-to-Sign</b>
        {account ? (
          <>
            {' · '}
            <a className="lk" href={accountUrl(account)} target="_blank" rel="noopener noreferrer">
              {shortAccount(account)}
            </a>
            <FundsText account={account} funds={funds} />
            {voiceOn && <span className="muted"> · voice on</span>}
          </>
        ) : (
          <span className="muted"> · not signed in</span>
        )}
      </span>
      {!account && walletConfigured && (
        <button type="button" className="btn btn-dark btn-xs" onClick={() => void openSignIn()}>
          Sign in
        </button>
      )}
      <span className="chip">Testnet</span>
    </div>
  );
}

/** " · 0.21 NEAR · 2.00 USDC", or what the faucet does now. */
function FundsText({ account, funds }: { account: string; funds: Funds }) {
  const { balance, faucet } = funds;
  if (faucet.kind === 'sending' || (faucet.kind === 'sent' && !covers(balance, 'bet'))) {
    return (
      <span className="muted setup-line-busy" role="status">
        {' · '}
        <span className="spinner" aria-hidden="true" /> getting testnet NEAR and USDC
      </span>
    );
  }
  if (faucet.kind === 'failed') {
    return (
      <span className="setup-line-error" role="alert">
        {' · '}the faucet failed{' '}
        <button type="button" className="link-btn" onClick={() => void retryFaucet(account)}>
          Try again
        </button>
      </span>
    );
  }
  if (!balance) return null;
  return (
    <span className="muted">
      {' · '}
      {balance.free === null ? 'not on testnet yet' : `${formatNear(balance.free)} · ${formatUsdc(balance.usdc)}`}
    </span>
  );
}

export interface SetupStepsProps {
  status: SignerStatus | null;
  account: string | undefined;
  signer: SignerSetup;
  walletConfigured: boolean;
  onSignIn: () => void;
  /** Called after a step changes the Wallet, to read the status again. */
  onChanged: () => void;
}

/**
 * The setup card's steps: sign in or create a wallet, set up your voice, testnet NEAR and USDC.
 * None of them is needed before the demo: the demo asks for each one when it needs it.
 */
export function SetupSteps({ status, account, signer, walletConfigured, onSignIn, onChanged }: SetupStepsProps) {
  const [busy, setBusy] = useState<VoicePhase | null>(null);
  const [outcome, setOutcome] = useState<SetupOutcome | null>(null);
  const enrolled = useEnrolled(account);
  const funds = useFunds(account, true);
  const signedIn = !!status?.signedIn;
  const voiceSetUp = !!status?.voiceReady && enrolled;
  const fundsReady = covers(funds.balance, 'bet');

  const voiceStep = async () => {
    if (!account) return;
    setOutcome(null);
    const result = await setUpVoice(signer, account, setBusy);
    setBusy(null);
    setOutcome(result);
    onChanged();
  };

  return (
    <>
      {busy && <WalletWait step={busy} />}
      <ol className="steps">
        <Step index={1} done={signedIn} label="Create a wallet, or sign in">
          {signedIn && account ? (
            <a className="lk small step-detail" href={accountUrl(account)} target="_blank" rel="noopener noreferrer">
              {shortAccount(account)}
            </a>
          ) : (
            <button type="button" className="btn btn-dark btn-xs" onClick={onSignIn} disabled={!walletConfigured}>
              Sign in
            </button>
          )}
        </Step>
        <Step index={2} done={voiceSetUp} label="Set up your voice">
          <button
            type="button"
            className={`btn btn-xs ${voiceSetUp ? 'btn-outline' : 'btn-dark'}`}
            disabled={!signedIn || busy !== null}
            onClick={() => void voiceStep()}
          >
            {busy ? 'Wait…' : voiceSetUp ? 'Again' : 'Set up'}
          </button>
        </Step>
        <Step index={3} done={signedIn && fundsReady} label="Testnet NEAR and USDC">
          {signedIn && <FundsStep account={account} funds={funds} />}
        </Step>
      </ol>
      {!walletConfigured && (
        <p className="side-note side-error" role="alert">
          This build has no Seams publishable key. Set <code>VITE_SEAMS_PUBLISHABLE_KEY</code> and build again.
        </p>
      )}
      {signedIn && account && <FundsNote account={account} funds={funds} />}
      {outcome && (
        <p className={`side-note ${outcome.kind === 'failed' ? 'side-error' : ''}`} role={outcome.kind === 'failed' ? 'alert' : 'status'}>
          {outcome.message}
        </p>
      )}
    </>
  );
}

/** The end of step 3: the balance, or what the faucet does now. */
function FundsStep({ account, funds }: { account: string | undefined; funds: Funds }) {
  const { balance, faucet } = funds;
  if (faucet.kind === 'sending' || (faucet.kind === 'sent' && !covers(balance, 'bet'))) {
    return (
      <span className="small muted step-detail">
        <span className="spinner" aria-hidden="true" /> Sending…
      </span>
    );
  }
  if (faucet.kind === 'failed' && account) {
    return (
      <button type="button" className="btn btn-dark btn-xs" onClick={() => void retryFaucet(account)}>
        Try again
      </button>
    );
  }
  if (!balance || balance.free === null) return null;
  return (
    <span className="small muted step-detail">
      {formatNear(balance.free)} · {formatUsdc(balance.usdc)}
    </span>
  );
}

/** The faucet's result under the steps: the transaction, or where else to get testnet funds. */
function FundsNote({ account, funds }: { account: string; funds: Funds }) {
  const { balance, faucet } = funds;
  if (faucet.kind === 'sent') {
    return (
      <p className="side-note" role="status">
        The faucet sent {formatNear(faucet.near)} and {formatUsdc(faucet.usdc)}.{' '}
        <a className="lk" href={transactionUrl(faucet.hash)} target="_blank" rel="noopener noreferrer">
          Transaction
          <IconExternalLink size={12} stroke={1.8} aria-hidden="true" />
        </a>
      </p>
    );
  }
  const short = faucet.kind === 'failed' || (faucet.kind === 'claimed' && !covers(balance, 'bet'));
  if (!short) return null;
  return (
    <p className={`side-note ${faucet.kind === 'failed' ? 'side-error' : ''}`} role={faucet.kind === 'failed' ? 'alert' : 'status'}>
      {faucet.kind === 'failed' ? `${faucet.text} ` : 'This account got the faucet before. '}
      You can get{' '}
      <a className="lk" href={config.faucetUrl} target="_blank" rel="noopener noreferrer">
        testnet NEAR
        <IconExternalLink size={12} stroke={1.8} aria-hidden="true" />
      </a>{' '}
      and{' '}
      <a className="lk" href={config.usdcFaucetUrl} target="_blank" rel="noopener noreferrer">
        testnet USDC
        <IconExternalLink size={12} stroke={1.8} aria-hidden="true" />
      </a>{' '}
      (network: NEAR testnet) for <code>{shortAccount(account)}</code> yourself.
    </p>
  );
}

/** One step. Its mark pops when the step becomes done while the visitor looks at it. */
function Step({ index, done, label, children }: { index: number; done: boolean; label: string; children?: React.ReactNode }) {
  const wasDone = useRef(done);
  const [justDone, setJustDone] = useState(false);
  useEffect(() => {
    if (done && !wasDone.current) setJustDone(true);
    wasDone.current = done;
  }, [done]);
  return (
    <li className={`step ${done ? 'step-done' : ''} ${justDone ? 'step-just-done' : ''}`}>
      <span className="step-mark" aria-hidden="true">
        {done ? <IconCheck size={14} stroke={3} /> : index}
      </span>
      <span className="step-text">
        {label}
        <span className="sr-only">{done ? ' (done)' : ' (not done)'}</span>
      </span>
      {children}
    </li>
  );
}

/**
 * A page-level card while the voice setup runs. It sits under the Wallet's own windows, so it
 * shows only in the gaps between them: the Wallet closes the VoiceID card for a few seconds
 * before the signed-message confirm of an enrollment opens (fixed in the next plugin release).
 */
export function WalletWait({ step }: { step: VoicePhase }) {
  return createPortal(
    <div className="wallet-wait" role="status" aria-live="polite">
      <div className="wallet-wait-card">
        <span className="spinner spinner-lg" aria-hidden="true" />
        <b>Setting up your voice</b>
        <span className="muted small">
          {step === 'enroll'
            ? 'Read the three phrases in the Seams Wallet window, then confirm one signed message. You do this once.'
            : 'Checking VoiceID. Follow the Seams Wallet window.'}
        </span>
      </div>
    </div>,
    document.body,
  );
}
