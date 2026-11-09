import { useCallback, useEffect, useState } from 'react';
import { IconCheck, IconExternalLink, IconMicrophone } from '@tabler/icons-react';
import { accountUrl, config, shortAccount } from '../config';
import { useDemo } from '../demoContext';
import { formatNear, NOTE_GAS_NEED_YOCTO, readFreeBalance } from '../notes/nearAccount';
import type { SetupOutcome } from '../signer/notesSigner';

/** The Wallet steps: sign in, turn on VoiceID, enroll, testnet NEAR. Compact form for narrow screens. */
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

type Balance = { kind: 'loading' } | { kind: 'ready'; free: bigint | null } | { kind: 'failed'; message: string };

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
  const { status, account, signer, reload, openSignIn } = useDemo();
  const [busy, setBusy] = useState<'voice' | 'enroll' | null>(null);
  const [outcome, setOutcome] = useState<SetupOutcome | null>(null);
  const [enrolled, setEnrolled] = useState(() => readEnrolled(account));
  const [balance, setBalance] = useState<Balance>({ kind: 'loading' });
  const signedIn = !!status?.signedIn;
  const voiceReady = !!status?.voiceReady;

  useEffect(() => setEnrolled(readEnrolled(account)), [account]);

  const loadBalance = useCallback(() => {
    if (!account) return;
    setBalance({ kind: 'loading' });
    readFreeBalance(config.rpcUrl, account).then(
      (free) => setBalance({ kind: 'ready', free }),
      (cause: unknown) => setBalance({ kind: 'failed', message: cause instanceof Error ? cause.message : String(cause) }),
    );
  }, [account]);
  useEffect(loadBalance, [loadBalance]);

  const run = async (step: 'voice' | 'enroll') => {
    setBusy(step);
    setOutcome(null);
    const result = step === 'voice' ? await signer.enableVoice() : await signer.enroll();
    setOutcome(result);
    if (step === 'enroll' && result.kind === 'done' && account) {
      setEnrolled(true);
      try {
        localStorage.setItem(enrolledKey(account), '1');
      } catch {
        // The step shows as done for this visit only.
      }
    }
    setBusy(null);
    reload();
  };

  const gasReady = balance.kind === 'ready' && balance.free !== null && balance.free >= NOTE_GAS_NEED_YOCTO;

  return (
    <>
      <p className="side-text">Post and rate notes with your voice. The Wallet signs from your own account, with no confirm tap.</p>
      <ol className="steps">
        <Step index={1} done={signedIn} label="Sign in to Seams Wallet">
          {signedIn && account ? (
            <a className="lk small step-detail" href={accountUrl(account)} target="_blank" rel="noopener noreferrer">
              {shortAccount(account)}
            </a>
          ) : (
            <button type="button" className="btn btn-dark btn-xs" onClick={openSignIn}>
              Sign in
            </button>
          )}
        </Step>
        <Step index={2} done={voiceReady} label="Turn on VoiceID">
          {!voiceReady && (
            <button type="button" className="btn btn-dark btn-xs" disabled={!signedIn || busy !== null} onClick={() => run('voice')}>
              {busy === 'voice' ? 'Wait…' : 'Turn on'}
            </button>
          )}
        </Step>
        <Step index={3} done={enrolled} label="Enroll your voice">
          <button
            type="button"
            className={`btn btn-xs ${enrolled ? 'btn-outline' : 'btn-dark'}`}
            disabled={!voiceReady || busy !== null}
            onClick={() => run('enroll')}
          >
            {busy === 'enroll' ? 'Wait…' : enrolled ? 'Again' : 'Enroll'}
          </button>
        </Step>
        <Step index={4} done={gasReady} label="Testnet NEAR for gas">
          {signedIn && (
            <span className="small muted step-detail">
              {balance.kind === 'loading'
                ? 'Checking…'
                : balance.kind === 'failed'
                  ? 'Unknown'
                  : balance.free === null
                    ? 'Not on testnet yet'
                    : formatNear(balance.free)}
            </span>
          )}
        </Step>
      </ol>
      {signedIn && !gasReady && balance.kind !== 'loading' && (
        <p className="side-note">
          Each note or rating pays a little gas.{' '}
          <a className="lk" href={config.faucetUrl} target="_blank" rel="noopener noreferrer">
            Get testnet NEAR
            <IconExternalLink size={12} stroke={1.8} aria-hidden="true" />
          </a>{' '}
          ·{' '}
          <button type="button" className="link-btn" onClick={loadBalance}>
            Check again
          </button>
        </p>
      )}
      {!enrolled && voiceReady && (
        <p className="side-note">Enroll once. You read three short phrases, then confirm one signed message.</p>
      )}
      {outcome && (
        <p className={`side-note ${outcome.kind === 'failed' ? 'side-error' : ''}`} role={outcome.kind === 'failed' ? 'alert' : 'status'}>
          {outcome.message}
        </p>
      )}
      <p className="side-note">
        Notes contract:{' '}
        <a className="lk" href={accountUrl(config.contract)} target="_blank" rel="noopener noreferrer">
          <code>{config.contract}</code>
        </a>
      </p>
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
