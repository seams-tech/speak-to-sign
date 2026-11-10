import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { IconCheck, IconExternalLink, IconMicrophone } from '@tabler/icons-react';
import { accountUrl, config, shortAccount, transactionUrl } from '../config';
import { useDemo } from '../demoContext';
import { requestFaucet } from '../faucet/client';
import { formatNear, formatUsdc, NOTE_GAS_NEED_YOCTO, readFreeBalance, readTokenBalance, USDC_NEED } from '../notes/nearAccount';
import type { SetupOutcome, SignerSetup, SignerStatus } from '../signer/notesSigner';

/**
 * A window event after a setup step changes the Wallet (the voice set up). The Speak-to-Sign page
 * and the notes app both show the steps, so each one reads the state again.
 */
export const SETUP_CHANGED = 'speak-to-sign:setup-changed';

/** The Wallet steps: sign in, set up your voice, testnet NEAR. Compact form for narrow screens. */
export function SetupPanel({ compact }: { compact: boolean }) {
  const { status, account } = useDemo();
  const ready = !!status?.signedIn && status.voiceReady;
  if (compact) {
    return (
      <details className="setup-compact">
        <summary>
          <IconMicrophone size={18} stroke={1.8} aria-hidden="true" />
          <span className="setup-compact-text">
            <b>Speak-to-Sign</b>{' '}
            <span className="muted">{ready && account ? `· ${shortAccount(account)} · voice on` : '· set up your Wallet'}</span>
          </span>
          <span className="chip">Testnet</span>
        </summary>
        <div className="setup-compact-body">
          <SetupBody />
        </div>
      </details>
    );
  }
  return (
    <section className="side-box" aria-labelledby="setup-title">
      <div className="side-title-row">
        <h2 id="setup-title" className="side-title">
          Speak-to-Sign
        </h2>
        <span className="chip">Testnet</span>
      </div>
      <SetupBody />
    </section>
  );
}

type Balance = { kind: 'loading' } | { kind: 'ready'; free: bigint | null; usdc: bigint } | { kind: 'failed'; message: string };

type Faucet = { kind: 'idle' } | { kind: 'busy' } | { kind: 'sent'; hash: string; text: string } | { kind: 'failed'; text: string };

function enrolledKey(account: string) {
  return `spoken-notes:enrolled:${account}`;
}

function readEnrolled(account: string | undefined): boolean {
  if (!account) return false;
  try {
    return localStorage.getItem(enrolledKey(account)) === '1';
  } catch {
    return false;
  }
}

function SetupBody() {
  const { status, account, signer, reload, openSignIn, walletConfigured } = useDemo();
  return (
    <SetupSteps
      status={status}
      account={account}
      signer={signer}
      walletConfigured={walletConfigured}
      onSignIn={openSignIn}
      onChanged={reload}
      variant="notes"
    />
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
  /** `notes`: with the notes line and the notes contract. `page`: the steps only. */
  variant: 'notes' | 'page';
}

/** The setup steps: sign in or create a wallet, set up your voice, testnet NEAR and USDC. */
export function SetupSteps({ status, account, signer, walletConfigured, onSignIn, onChanged, variant }: SetupStepsProps) {
  const openSignIn = onSignIn;
  const reload = () => {
    onChanged();
    window.dispatchEvent(new Event(SETUP_CHANGED));
  };
  const [busy, setBusy] = useState<VoicePhase | null>(null);
  const [outcome, setOutcome] = useState<SetupOutcome | null>(null);
  const [enrolled, setEnrolled] = useState(() => readEnrolled(account));
  const [balance, setBalance] = useState<Balance>({ kind: 'loading' });
  const [faucet, setFaucet] = useState<Faucet>({ kind: 'idle' });
  const signedIn = !!status?.signedIn;
  const voiceReady = !!status?.voiceReady;

  useEffect(() => {
    setEnrolled(readEnrolled(account));
    const onChange = () => setEnrolled(readEnrolled(account));
    window.addEventListener(SETUP_CHANGED, onChange);
    return () => window.removeEventListener(SETUP_CHANGED, onChange);
  }, [account]);

  const loadBalance = useCallback(() => {
    if (!account) return;
    setBalance({ kind: 'loading' });
    Promise.all([readFreeBalance(config.rpcUrl, account), readTokenBalance(config.marketRpcUrl, config.marketToken, account)]).then(
      ([free, usdc]) => setBalance({ kind: 'ready', free, usdc }),
      (cause: unknown) => setBalance({ kind: 'failed', message: cause instanceof Error ? cause.message : String(cause) }),
    );
  }, [account]);
  useEffect(loadBalance, [loadBalance]);
  useEffect(() => setFaucet({ kind: 'idle' }), [account]);

  // The faucet: one transaction sends 0.2 NEAR for gas and 2 USDC for bets, once per account.
  const getFunds = async () => {
    if (!account) return;
    setFaucet({ kind: 'busy' });
    const result = await requestFaucet(account);
    if (!result.ok) {
      setFaucet({ kind: 'failed', text: result.error });
      return;
    }
    setFaucet({ kind: 'sent', hash: result.transactionHash, text: `Sent ${formatNear(result.near)} and ${formatUsdc(result.usdc)}.` });
    // The NEAR transfer lands a block after the USDC; read the balances when both are in.
    window.setTimeout(loadBalance, 2500);
  };

  // One step and one set of recordings for the user: turn VoiceID back on if it was turned
  // off, then enroll. For a wallet without VoiceID, the enrollment turns it on and the Wallet
  // uses the same three recordings for VoiceID and the verifier.
  const setUpVoice = async () => {
    setOutcome(null);
    setBusy('voice');
    const voice = await signer.enableVoice();
    if (voice.kind !== 'done') {
      setOutcome(voice);
      setBusy(null);
      reload();
      return;
    }
    setBusy('enroll');
    const enrollment = await signer.enroll();
    if (enrollment.kind === 'done') {
      setOutcome({ kind: 'done', message: `Your voice is set up. ${enrollment.message}` });
      if (account) {
        setEnrolled(true);
        try {
          localStorage.setItem(enrolledKey(account), '1');
        } catch {
          // The step shows as done for this visit only.
        }
      }
    } else {
      setOutcome(enrollment);
    }
    setBusy(null);
    reload();
  };

  const voiceSetUp = voiceReady && enrolled;

  const gasReady = balance.kind === 'ready' && balance.free !== null && balance.free >= NOTE_GAS_NEED_YOCTO;
  const usdcReady = balance.kind === 'ready' && balance.usdc >= USDC_NEED;
  const fundsReady = gasReady && usdcReady;

  return (
    <>
      {busy && <WalletWait step={busy} />}
      {variant === 'notes' && (
        <p className="side-text">Post and rate notes with your voice. The Wallet signs from your own account, with no confirm tap.</p>
      )}
      <ol className="steps">
        <Step index={1} done={signedIn} label={variant === 'page' ? 'Create a wallet, or sign in' : 'Sign in to Seams Wallet'}>
          {signedIn && account ? (
            <a className="lk small step-detail" href={accountUrl(account)} target="_blank" rel="noopener noreferrer">
              {shortAccount(account)}
            </a>
          ) : (
            <button type="button" className="btn btn-dark btn-xs" onClick={openSignIn} disabled={!walletConfigured}>
              Sign in
            </button>
          )}
        </Step>
        <Step index={2} done={voiceSetUp} label="Set up your voice">
          <button
            type="button"
            className={`btn btn-xs ${voiceSetUp ? 'btn-outline' : 'btn-dark'}`}
            disabled={!signedIn || busy !== null}
            onClick={setUpVoice}
          >
            {busy ? 'Wait…' : voiceSetUp ? 'Again' : 'Set up'}
          </button>
        </Step>
        <Step index={3} done={fundsReady} label="Testnet NEAR and USDC">
          {signedIn && fundsReady && balance.kind === 'ready' && balance.free !== null && (
            <span className="small muted step-detail">
              {formatNear(balance.free)} · {formatUsdc(balance.usdc)}
            </span>
          )}
          {signedIn && !fundsReady && (
            <button type="button" className="btn btn-dark btn-xs" disabled={faucet.kind === 'busy' || balance.kind === 'loading'} onClick={() => void getFunds()}>
              {faucet.kind === 'busy' ? 'Sending…' : 'Get'}
            </button>
          )}
        </Step>
      </ol>
      {!walletConfigured && (
        <p className="side-note side-error" role="alert">
          This build has no Seams publishable key. Set <code>VITE_SEAMS_PUBLISHABLE_KEY</code> and build again.
        </p>
      )}
      {signedIn && !fundsReady && balance.kind === 'ready' && faucet.kind !== 'sent' && faucet.kind !== 'failed' && (
        <p className="side-note">
          {balance.free === null
            ? 'Your account is not on testnet yet. '
            : `You have ${formatNear(balance.free)} and ${formatUsdc(balance.usdc)}. `}
          Get sends 0.2 NEAR for gas and 2 USDC for bets, in one transaction, once per account.
        </p>
      )}
      {faucet.kind === 'sent' && (
        <p className="side-note" role="status">
          {faucet.text}{' '}
          <a className="lk" href={transactionUrl(faucet.hash)} target="_blank" rel="noopener noreferrer">
            Transaction
            <IconExternalLink size={12} stroke={1.8} aria-hidden="true" />
          </a>
        </p>
      )}
      {faucet.kind === 'failed' && (
        <p className="side-note side-error" role="alert">
          {faucet.text} You can also get{' '}
          <a className="lk" href={config.faucetUrl} target="_blank" rel="noopener noreferrer">
            testnet NEAR
            <IconExternalLink size={12} stroke={1.8} aria-hidden="true" />
          </a>{' '}
          and{' '}
          <a className="lk" href={config.usdcFaucetUrl} target="_blank" rel="noopener noreferrer">
            testnet USDC
            <IconExternalLink size={12} stroke={1.8} aria-hidden="true" />
          </a>{' '}
          (network: NEAR testnet) yourself.{' '}
          <button type="button" className="link-btn" onClick={loadBalance}>
            Check again
          </button>
        </p>
      )}
      {signedIn && !voiceSetUp && (
        <p className="side-note">
          {voiceReady
            ? 'Set up once. You read three short phrases, then confirm one signed message.'
            : 'Set up once. The Wallet may ask for your passkey. Then you read three short phrases, which set up VoiceID on this device and the verifier, and confirm one signed message.'}
        </p>
      )}
      {outcome && (
        <p className={`side-note ${outcome.kind === 'failed' ? 'side-error' : ''}`} role={outcome.kind === 'failed' ? 'alert' : 'status'}>
          {outcome.message}
        </p>
      )}
      {variant === 'notes' && (
        <p className="side-note">
          Notes contract:{' '}
          <a className="lk" href={accountUrl(config.contract)} target="_blank" rel="noopener noreferrer">
            <code>{config.contract}</code>
          </a>
        </p>
      )}
    </>
  );
}

function Step({ index, done, label, children }: { index: number; done: boolean; label: string; children?: React.ReactNode }) {
  return (
    <li className={`step ${done ? 'step-done' : ''}`}>
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

/** The two parts of "Set up your voice". */
type VoicePhase = 'voice' | 'enroll';

/**
 * A page-level card while the voice setup runs. It sits under the Wallet's own windows, so it
 * shows only in the gaps between them: the Wallet closes the VoiceID card for a few seconds
 * before the signed-message confirm of an enrollment opens (fixed in the next plugin release).
 */
function WalletWait({ step }: { step: VoicePhase }) {
  return createPortal(
    <div className="wallet-wait" role="status" aria-live="polite">
      <div className="wallet-wait-card">
        <span className="spinner spinner-lg" aria-hidden="true" />
        <b>Setting up your voice</b>
        <span className="muted small">
          {step === 'enroll'
            ? 'Setting up your voice. Read the three phrases in the Seams Wallet window, then confirm one signed message.'
            : 'Checking VoiceID. Follow the Seams Wallet window.'}
        </span>
      </div>
    </div>,
    document.body,
  );
}

export function HowItWorks() {
  return (
    <section className="side-box" aria-labelledby="how-title">
      <h2 id="how-title" className="side-title">
        How a voice signs
      </h2>
      <dl className="how">
        <dt>Biometric CAPTCHA</dt>
        <dd>An attested verifier hears you. It checks that the account owner speaks and that the words match the request.</dd>
        <dt>Spoken Lease</dt>
        <dd>
          Then the Wallet signs one call from your account: <code>add_note</code> or <code>rate_note</code>. The lease covers that one call and ends after two minutes.
        </dd>
      </dl>
    </section>
  );
}
