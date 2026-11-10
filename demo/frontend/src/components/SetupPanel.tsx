import { useEffect, useRef, useState } from 'react';
import { IconCheck, IconExternalLink, IconMicrophone } from '@tabler/icons-react';
import { accountUrl, config, shortAccount, transactionUrl } from '../config';
import { useDemo } from '../demoContext';
import { covers, retryFaucet, useFunds, type FaucetState, type Funds } from '../faucet/funds';
import { FloatingError, FloatingErrors } from './FloatingError';
import { formatNear, formatUsdc, nearAmount, usdcAmount } from '../notes/nearAccount';
import { NearMark } from '../showcase/nearMarks';
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
  /** The faucet failure that the visitor closed. A new failure shows again. */
  const [closedFaucet, setClosedFaucet] = useState<FaucetState | null>(null);
  const enrolled = useEnrolled(account);
  const funds = useFunds(account, true);
  const signedIn = !!status?.signedIn;
  const voiceSetUp = !!status?.voiceReady && enrolled;
  const fundsReady = covers(funds.balance, 'bet');
  const voiceError = outcome?.kind === 'failed' ? outcome.message : null;
  const faucetError = signedIn && account && funds.faucet.kind === 'failed' && funds.faucet !== closedFaucet ? funds.faucet : null;

  const voiceStep = async () => {
    if (!account) return;
    setOutcome(null);
    const result = await setUpVoice(signer, account, setBusy);
    setBusy(null);
    // A closed Wallet window needs no note: the step shows "Set up" again.
    setOutcome(result.kind === 'cancelled' ? null : result);
    onChanged();
  };

  return (
    <>
      <ol className="steps">
        <Step index={1} done={signedIn} label="Create a wallet">
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
        <Step index={3} done={signedIn && fundsReady} labelHidden={signedIn && fundsReady} label="Testnet NEAR and USDC">
          {signedIn && <FundsStep account={account} funds={funds} />}
        </Step>
      </ol>
      {!walletConfigured && (
        <p className="side-note side-error" role="alert">
          This build has no Seams publishable key. Set <code>VITE_SEAMS_PUBLISHABLE_KEY</code> and build again.
        </p>
      )}
      {signedIn && account && <FundsNote account={account} funds={funds} />}
      {outcome?.kind === 'done' && (
        <p className="side-note" role="status">
          {outcome.message}
        </p>
      )}
      {/* The errors float at the bottom of the screen, not under the steps. */}
      {(voiceError || faucetError) && (
        <FloatingErrors>
          {voiceError && <FloatingError onClose={() => setOutcome(null)}>{voiceError}</FloatingError>}
          {faucetError && account && (
            <FloatingError onClose={() => setClosedFaucet(faucetError)}>
              {faucetError.text} <FaucetLinks account={account} />
            </FloatingError>
          )}
        </FloatingErrors>
      )}
    </>
  );
}

/** The end of step 3: the two balances, each after its token's icon, or what the faucet does now. */
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
    <span className="small muted step-detail step-tokens">
      <span className="token">
        <NearToken />
        {nearAmount(balance.free)}
        <span className="sr-only"> NEAR</span>
      </span>
      <span className="token">
        <UsdcToken />
        {usdcAmount(balance.usdc)}
        <span className="sr-only"> USDC</span>
      </span>
    </span>
  );
}

/** NEAR's token icon: its N on a white disc. */
function NearToken() {
  return (
    <span className="token-icon token-near" aria-hidden="true">
      <NearMark />
    </span>
  );
}

/** USDC's token icon: the white dollar sign and its two arcs on Circle's blue disc. */
function UsdcToken() {
  return (
    <svg className="token-icon" viewBox="0 0 2000 2000" aria-hidden="true" focusable="false">
      <circle cx="1000" cy="1000" r="1000" fill="#2775ca" />
      <path
        fill="#ffffff"
        d="M1275 1158.33c0-145.83-87.5-195.83-262.5-216.66-125-16.67-150-50-150-108.34s41.67-95.83 125-95.83c75 0 116.67 25 137.5 87.5 4.17 12.5 16.67 20.83 29.17 20.83h66.66c16.67 0 29.17-12.5 29.17-29.16v-4.17c-16.67-91.67-91.67-162.5-187.5-170.83v-100c0-16.67-12.5-29.17-33.33-33.34h-62.5c-16.67 0-29.17 12.5-33.34 33.34v95.83c-125 16.67-204.16 100-204.16 204.17 0 137.5 83.33 191.66 258.33 212.5 116.67 20.83 154.17 45.83 154.17 112.5s-58.34 112.5-137.5 112.5c-108.34 0-145.84-45.84-158.34-108.34-4.16-16.66-16.66-25-29.16-25h-70.84c-16.66 0-29.16 12.5-29.16 29.17v4.17c16.66 104.16 83.33 179.16 220.83 200v100c0 16.66 12.5 29.16 33.33 33.33h62.5c16.67 0 29.17-12.5 33.34-33.33v-100c125-20.84 208.33-108.34 208.33-220.84z"
      />
      <path
        fill="#ffffff"
        d="M787.5 1595.83c-325-116.66-491.67-479.16-370.83-800 62.5-175 200-308.33 370.83-370.83 16.67-8.33 25-20.83 25-41.67V325c0-16.67-8.33-29.17-25-33.33-4.17 0-12.5 0-16.67 4.16-395.83 125-612.5 545.84-487.5 941.67 75 233.33 254.17 412.5 487.5 487.5 16.67 8.33 33.34 0 37.5-16.67 4.17-4.16 4.17-8.33 4.17-16.66v-58.34c0-12.5-12.5-29.16-25-37.5zM1229.17 295.83c-16.67-8.33-33.34 0-37.5 16.67-4.17 4.17-4.17 8.33-4.17 16.67v58.33c0 16.67 12.5 33.33 25 41.67 325 116.66 491.67 479.16 370.83 800-62.5 175-200 308.33-370.83 370.83-16.67 8.33-25 20.83-25 41.67V1700c0 16.67 8.33 29.17 25 33.33 4.17 0 12.5 0 16.67-4.16 395.83-125 612.5-545.84 487.5-941.67-75-237.5-258.34-416.67-487.5-491.67z"
      />
    </svg>
  );
}

/**
 * The faucet's result under the steps: the transaction, or where else to get testnet funds. A
 * failure floats at the bottom of the screen instead (SetupSteps).
 */
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
  if (faucet.kind !== 'claimed' || covers(balance, 'bet')) return null;
  return (
    <p className="side-note" role="status">
      This account got the faucet before. <FaucetLinks account={account} />
    </p>
  );
}

/** Where else to get testnet NEAR and USDC for the account. */
function FaucetLinks({ account }: { account: string }) {
  return (
    <>
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
    </>
  );
}

/** One step. Its mark pops when the step becomes done while the visitor looks at it. */
function Step({
  index,
  done,
  label,
  labelHidden = false,
  children,
}: {
  index: number;
  done: boolean;
  label: string;
  /** Only screen readers read the label: what the step shows says it. */
  labelHidden?: boolean;
  children?: React.ReactNode;
}) {
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
      <span className={labelHidden ? 'step-text sr-only' : 'step-text'}>
        {label}
        <span className="sr-only">{done ? ' (done)' : ' (not done)'}</span>
      </span>
      {children}
    </li>
  );
}
