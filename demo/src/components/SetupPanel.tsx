import { useState } from 'react';
import { IconCheck, IconMicrophone } from '@tabler/icons-react';
import { config } from '../config';
import { useDemo } from '../demoContext';
import type { MockOutcome } from '../signer/mockBackend';

const OUTCOME_LABELS: Record<MockOutcome, string> = {
  sent: 'Sent',
  refused: 'Refused',
  cancelled: 'Cancelled',
  unavailable: 'Unavailable',
};

/** The Wallet steps: sign in, turn on VoiceID, enroll. Compact form for narrow screens. */
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
            <span className="muted">{ready ? `· ${account} · voice ready` : '· set up the Wallet'}</span>
          </span>
          <ModeChip />
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
        <ModeChip />
      </div>
      <SetupBody />
    </section>
  );
}

function ModeChip() {
  return <span className={`chip ${config.mock ? 'chip-mock' : ''}`}>{config.mock ? 'Mock mode' : 'Testnet'}</span>;
}

function SetupBody() {
  const { status, account, services, reload } = useDemo();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const signedIn = !!status?.signedIn;
  const voiceReady = !!status?.voiceReady;

  const steps = [
    { id: 'sign_in', label: 'Sign in to Seams Wallet', done: signedIn, detail: signedIn ? account : undefined, run: services.setup.signIn, runLabel: 'Sign in', blocked: false },
    { id: 'voice', label: 'Turn on VoiceID', done: voiceReady, run: services.setup.enableVoice, runLabel: 'Turn on', blocked: !signedIn },
    { id: 'enroll', label: 'Enroll your voice', done: voiceReady, run: services.setup.enroll, runLabel: 'Enroll', blocked: !signedIn },
  ];

  const run = async (id: string, action: () => Promise<void>) => {
    setBusy(id);
    setError(null);
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The Wallet step did not finish.');
    } finally {
      setBusy(null);
      reload();
    }
  };

  return (
    <>
      <p className="side-text">Post and rate notes with your voice. The Wallet signs from your own account, with no confirm tap.</p>
      <ol className="steps">
        {steps.map((step, index) => (
          <li key={step.id} className={`step ${step.done ? 'step-done' : ''}`}>
            <span className="step-mark" aria-hidden="true">
              {step.done ? <IconCheck size={14} stroke={3} /> : index + 1}
            </span>
            <span className="step-text">
              {step.label}
              {step.detail && <span className="muted"> · {step.detail}</span>}
              <span className="sr-only">{step.done ? ' (done)' : ' (not done)'}</span>
            </span>
            {!step.done && step.run && (
              <button
                type="button"
                className="btn btn-dark btn-xs"
                disabled={step.blocked || busy !== null}
                onClick={() => step.run && run(step.id, step.run)}
              >
                {busy === step.id ? 'Wait…' : step.runLabel}
              </button>
            )}
          </li>
        ))}
      </ol>
      {!config.mock && !signedIn && !services.setup.signIn && (
        <p className="side-note">The Seams Wallet steps come with SDK 0.59.0. Until then, the sign buttons say “not available”.</p>
      )}
      {error && (
        <p className="side-note side-error" role="alert">
          {error}
        </p>
      )}
      {services.mock && <MockControlsView />}
      <p className="side-note">
        {config.mock ? (
          'Notes live in an in-memory copy of the notes contract. A reload resets them.'
        ) : (
          <>
            Notes contract: <code>{config.contract}</code>
          </>
        )}
      </p>
    </>
  );
}

function MockControlsView() {
  const { services } = useDemo();
  const mock = services.mock;
  if (!mock) return null;
  const current = mock.account();
  return (
    <div className="mock-box">
      <div className="mock-row">
        <span className="mock-label" id="mock-account-label">
          Mock account
        </span>
        <div className="seg" role="group" aria-labelledby="mock-account-label">
          {mock.accounts.map((accountId) => (
            <button
              key={accountId}
              type="button"
              className={`seg-btn ${accountId === current ? 'seg-on' : ''}`}
              aria-pressed={accountId === current}
              onClick={() => mock.setAccount(accountId)}
            >
              {accountId.replace('.testnet', '')}
            </button>
          ))}
        </div>
      </div>
      <label className="mock-row">
        <span className="mock-label">Next result</span>
        <select className="select" value={mock.outcome()} onChange={(event) => mock.setOutcome(event.target.value as MockOutcome)}>
          {(Object.keys(OUTCOME_LABELS) as MockOutcome[]).map((outcome) => (
            <option key={outcome} value={outcome}>
              {OUTCOME_LABELS[outcome]}
            </option>
          ))}
        </select>
      </label>
    </div>
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
