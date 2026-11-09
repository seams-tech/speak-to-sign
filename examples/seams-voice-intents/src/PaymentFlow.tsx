import React from 'react';
import type { SpeakToSignEnrollmentResult, SpeakToSignTransferResult } from '@seams/wallet';
import { HostedSeamsAuthMenu, useSeams, type HostedAuthMenuOutcome } from '@seams/wallet/react';
import {
  DEFAULT_RECEIVER,
  FAUCET_URL,
  PAYMENT_NEED_YOCTO,
  RECEIPT_BASE_URL,
  formatNear,
  parseSpokenAmount,
  readFreeBalance,
} from './chain';
import { CopyButton, LoadingButton } from './components';
import {
  STAGE_LABELS,
  enrollmentRefusalText,
  errorMessage,
  formatSeconds,
  transferRefusalText,
  unavailableText,
} from './text';

type Seams = ReturnType<typeof useSeams>['seams'];
type Availability = Awaited<ReturnType<Seams['registration']['getAuthMethodAvailability']>>;
type StepStatus = 'checking' | 'waiting' | 'todo' | 'working' | 'done' | 'failed';
type Loaded<T> =
  | Readonly<{ kind: 'loading' }>
  | Readonly<{ kind: 'ready'; value: T }>
  | Readonly<{ kind: 'failed'; message: string }>;
type Outcome<T> =
  | Readonly<{ kind: 'idle' }>
  | Readonly<{ kind: 'working' }>
  | Readonly<{ kind: 'result'; value: T }>
  | Readonly<{ kind: 'failed'; message: string }>;
type Owner = Readonly<{ seams: Seams; walletId: string; nearAccountId: string; rpcUrl: string }>;

const STATUS_LABELS: Record<StepStatus, string> = {
  checking: 'Checking',
  waiting: 'Waiting',
  todo: 'To do',
  working: 'In progress',
  done: 'Done',
  failed: 'Failed',
};

/** Runs `load` on mount and on each `reload`. It keeps the last value while it reloads. */
function useLoaded<T>(load: () => Promise<T>): [Loaded<T>, () => void] {
  const [state, setState] = React.useState<Loaded<T>>({ kind: 'loading' });
  const [round, setRound] = React.useState(0);
  React.useEffect(() => {
    let live = true;
    load().then(
      (value) => live && setState({ kind: 'ready', value }),
      (error: unknown) => live && setState({ kind: 'failed', message: errorMessage(error) }),
    );
    return () => {
      live = false;
    };
  }, [load, round]);
  const reload = React.useCallback(() => setRound((value) => value + 1), []);
  return [state, reload];
}

/** Runs one owner action at a time and keeps its last result. */
function useOutcome<T>(): [Outcome<T>, (run: () => Promise<T>) => Promise<T | null>] {
  const [outcome, setOutcome] = React.useState<Outcome<T>>({ kind: 'idle' });
  const start = React.useCallback(async (run: () => Promise<T>) => {
    setOutcome({ kind: 'working' });
    try {
      const value = await run();
      setOutcome({ kind: 'result', value });
      return value;
    } catch (error: unknown) {
      setOutcome({ kind: 'failed', message: errorMessage(error) });
      return null;
    }
  }, []);
  return [outcome, start];
}

function StepCard(props: {
  index: number;
  title: string;
  status: StepStatus;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <section
      className="svi-step"
      data-status={props.status}
      aria-labelledby={`svi-step-${props.index}`}
    >
      <header className="svi-step__head">
        <span className="svi-step__index" aria-hidden>
          {props.index}
        </span>
        <h2 className="svi-step__title" id={`svi-step-${props.index}`}>
          {props.title}
        </h2>
        <span className="svi-pill" data-status={props.status}>
          {STATUS_LABELS[props.status]}
        </span>
      </header>
      <div className="svi-step__body">{props.children}</div>
    </section>
  );
}

function Notice(props: { tone: 'info' | 'error' | 'success'; children: React.ReactNode }) {
  return (
    <div
      className="svi-notice"
      data-tone={props.tone}
      role={props.tone === 'error' ? 'alert' : 'status'}
    >
      {props.children}
    </div>
  );
}

function ReceiptLink({ hash }: { hash: string }): React.JSX.Element {
  return (
    <a href={`${RECEIPT_BASE_URL}${hash}`} target="_blank" rel="noopener noreferrer">
      View the transaction on NearBlocks
    </a>
  );
}

function Fact(props: { label: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="svi-fact">
      <dt>{props.label}</dt>
      <dd>{props.children}</dd>
    </div>
  );
}

function VoiceIdStep(props: {
  owner: Owner;
  availability: Loaded<Availability>;
  onChanged: () => void;
}): React.JSX.Element {
  const { owner, availability, onChanged } = props;
  const [outcome, start] = useOutcome<string>();
  const turnOn = React.useCallback(async () => {
    const current = availability.kind === 'ready' ? availability.value.kind : 'not_enrolled';
    await start(async () => {
      if (current === 'disabled') {
        await owner.seams.registration.setAuthMethodEnabled({
          walletId: owner.walletId,
          method: 'voiceid',
          enabled: true,
        });
        return 'VoiceID is on again.';
      }
      const result = await owner.seams.registration.activateAuthMethod({
        walletId: owner.walletId,
        method: 'voiceid',
      });
      return result.kind === 'activated'
        ? 'VoiceID is on.'
        : 'You closed the VoiceID window. Nothing changed.';
    });
    onChanged();
  }, [availability, onChanged, owner, start]);

  const status: StepStatus =
    outcome.kind === 'working'
      ? 'working'
      : availability.kind === 'loading'
        ? 'checking'
        : availability.kind === 'failed'
          ? 'failed'
          : availability.value.kind === 'enabled'
            ? 'done'
            : 'todo';

  return (
    <StepCard index={1} title="Turn on VoiceID" status={status}>
      {availability.kind === 'failed' ? <Notice tone="error">{availability.message}</Notice> : null}
      {status === 'done' ? (
        <p>VoiceID is on for this wallet. The Wallet uses it to record your spoken payments.</p>
      ) : (
        <>
          <p>
            A spoken payment records your voice in the VoiceID window of the Wallet. Turn on VoiceID
            first. The Wallet asks you to read a few short phrases.
          </p>
          <p className="svi-hint">
            You must be unlocked with your passkey. You can also turn on VoiceID in the account
            settings of the Wallet.
          </p>
          <LoadingButton
            onClick={turnOn}
            loading={outcome.kind === 'working'}
            loadingText="Waiting for VoiceID..."
            disabled={availability.kind !== 'ready'}
            style={{ width: '100%' }}
          >
            {availability.kind === 'ready' && availability.value.kind === 'disabled'
              ? 'Turn VoiceID on again'
              : 'Turn on VoiceID'}
          </LoadingButton>
        </>
      )}
      {outcome.kind === 'result' ? <Notice tone="info">{outcome.value}</Notice> : null}
      {outcome.kind === 'failed' ? <Notice tone="error">{outcome.message}</Notice> : null}
    </StepCard>
  );
}

function EnrollmentResult({ result }: { result: SpeakToSignEnrollmentResult }): React.JSX.Element {
  switch (result.kind) {
    case 'enrolled':
      return (
        <Notice tone="success">
          The verifier stored your voice template. Template epoch {result.templateEpoch}, agreement{' '}
          {(result.agreementMilli / 1000).toFixed(3)}.
        </Notice>
      );
    case 'refused':
      return (
        <Notice tone="error">
          Refused (<code>{result.reason}</code>): {enrollmentRefusalText(result.reason)}
          {result.detail ? ` ${result.detail}` : ''}
        </Notice>
      );
    case 'cancelled':
      return <Notice tone="info">You closed a Wallet window. Nothing was enrolled.</Notice>;
    case 'unavailable':
      return (
        <Notice tone="error">
          Unavailable (<code>{result.reason}</code>): {unavailableText(result.reason)}
          {result.detail ? ` ${result.detail}` : ''}
        </Notice>
      );
  }
}

function EnrollStep(props: { owner: Owner; ready: boolean }): React.JSX.Element {
  const { owner, ready } = props;
  const [outcome, start] = useOutcome<SpeakToSignEnrollmentResult>();
  const enroll = React.useCallback(async () => {
    await start(async () => {
      const speakToSign = owner.seams.speakToSign;
      if (!speakToSign) throw new Error('Speak-to-Sign is not configured.');
      return await speakToSign.enroll({ walletId: owner.walletId });
    });
  }, [owner, start]);
  const status: StepStatus =
    outcome.kind === 'working'
      ? 'working'
      : outcome.kind === 'failed'
        ? 'failed'
        : outcome.kind === 'result'
          ? outcome.value.kind === 'enrolled'
            ? 'done'
            : outcome.value.kind === 'cancelled'
              ? 'todo'
              : 'failed'
          : ready
            ? 'todo'
            : 'waiting';

  return (
    <StepCard index={2} title="Enroll your voice" status={status}>
      <p>
        The verifier compares each payment with a template of your voice. The Wallet shows three
        short phrases, one at a time. Read each one aloud. Then confirm one signed message that
        names exactly these recordings.
      </p>
      <p className="svi-hint">
        If you enrolled this wallet with this version before, you can skip this step. A new
        enrollment replaces the template.
      </p>
      {!ready ? <Notice tone="info">Turn on VoiceID first.</Notice> : null}
      <LoadingButton
        onClick={enroll}
        loading={outcome.kind === 'working'}
        loadingText="Enrolling..."
        disabled={!ready}
        style={{ width: '100%' }}
      >
        Enroll my voice
      </LoadingButton>
      {outcome.kind === 'result' ? <EnrollmentResult result={outcome.value} /> : null}
      {outcome.kind === 'failed' ? <Notice tone="error">{outcome.message}</Notice> : null}
    </StepCard>
  );
}

function BalanceStep(props: {
  owner: Owner;
  balance: Loaded<bigint | null>;
  onRefresh: () => void;
}): React.JSX.Element {
  const { owner, balance, onRefresh } = props;
  const free = balance.kind === 'ready' ? balance.value : null;
  const status: StepStatus =
    balance.kind === 'loading'
      ? 'checking'
      : balance.kind === 'failed'
        ? 'failed'
        : free !== null && free >= PAYMENT_NEED_YOCTO
          ? 'done'
          : 'todo';

  return (
    <StepCard index={3} title="Check your balance" status={status}>
      <dl className="svi-facts">
        <Fact label="NEAR account">
          <span className="svi-account">
            <code>{owner.nearAccountId}</code>
            <CopyButton text={owner.nearAccountId} ariaLabel="Copy the NEAR account" />
          </span>
        </Fact>
        <Fact label="Free balance">
          {balance.kind === 'ready'
            ? free === null
              ? 'This account is not on testnet yet'
              : formatNear(free)
            : balance.kind === 'failed'
              ? 'Unknown'
              : 'Checking...'}
        </Fact>
        <Fact label="You need">The amount of each payment, plus less than 0.0001 NEAR of gas</Fact>
      </dl>
      {balance.kind === 'failed' ? <Notice tone="error">{balance.message}</Notice> : null}
      <p className="svi-hint">
        A spoken payment is a plain transfer from your own account. There is no vault and no
        deposit.
      </p>
      {status === 'todo' ? (
        <p>
          Copy your account, then get testnet NEAR from the{' '}
          <a href={FAUCET_URL} target="_blank" rel="noopener noreferrer">
            NEAR testnet faucet
          </a>
          .
        </p>
      ) : null}
      <LoadingButton onClick={onRefresh} variant="secondary" style={{ width: '100%' }}>
        Check again
      </LoadingButton>
    </StepCard>
  );
}

function TransferResult({ result }: { result: SpeakToSignTransferResult }): React.JSX.Element {
  switch (result.kind) {
    case 'sent':
      return (
        <Notice tone="success">
          <p>
            {result.approval === 'voice'
              ? 'Paid from your account by voice, with no confirm.'
              : 'Paid from your account after your voice and your confirm.'}{' '}
            <ReceiptLink hash={result.transactionHash} />
          </p>
          <dl className="svi-facts svi-facts--times">
            {STAGE_LABELS.map(([key, label]) => (
              <Fact key={key} label={label}>
                {formatSeconds(result.times[key])}
              </Fact>
            ))}
          </dl>
        </Notice>
      );
    case 'refused':
      return (
        <Notice tone="error">
          Refused (<code>{result.reason}</code>): {transferRefusalText(result.reason)}
          {result.detail ? ` ${result.detail}` : ''} Nothing was sent.
        </Notice>
      );
    case 'cancelled':
      return <Notice tone="info">You closed the VoiceID window. Nothing was sent.</Notice>;
    case 'unavailable':
      return (
        <Notice tone="error">
          Unavailable (<code>{result.reason}</code>): {unavailableText(result.reason)}
          {result.detail ? ` ${result.detail}` : ''}
        </Notice>
      );
  }
}

function PayStep(props: { owner: Owner; ready: boolean; onPaid: () => void }): React.JSX.Element {
  const { owner, ready, onPaid } = props;
  const [amountText, setAmountText] = React.useState('0.01');
  const [receiver, setReceiver] = React.useState(DEFAULT_RECEIVER);
  const chosen = receiver.trim();
  const amount = parseSpokenAmount(amountText);
  const [outcome, start] = useOutcome<SpeakToSignTransferResult>();
  const pay = React.useCallback(async () => {
    const speakToSign = owner.seams.speakToSign;
    if (!speakToSign || !amount.ok || !chosen) return;
    const result = await start(() =>
      speakToSign.requestTransfer({
        walletId: owner.walletId,
        receiver: chosen,
        amount: amount.amount,
      }),
    );
    if (result?.kind === 'sent') onPaid();
  }, [amount, chosen, onPaid, owner, start]);
  const canPay = ready && amount.ok && Boolean(chosen) && outcome.kind !== 'working';
  const status: StepStatus =
    outcome.kind === 'working'
      ? 'working'
      : outcome.kind === 'failed'
        ? 'failed'
        : outcome.kind === 'result'
          ? outcome.value.kind === 'sent'
            ? 'done'
            : outcome.value.kind === 'cancelled'
              ? 'todo'
              : 'failed'
          : ready
            ? 'todo'
            : 'waiting';

  return (
    <StepCard index={4} title="Pay by voice" status={status}>
      {!ready ? <Notice tone="info">Turn on VoiceID first.</Notice> : null}
      <div className="svi-row">
        <label className="svi-field">
          <span>Amount in NEAR</span>
          <input
            type="text"
            inputMode="decimal"
            value={amountText}
            onChange={(event) => setAmountText(event.target.value)}
            aria-invalid={!amount.ok}
          />
        </label>
        <label className="svi-field">
          <span>Pay to</span>
          <input
            type="text"
            value={receiver}
            onChange={(event) => setReceiver(event.target.value)}
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="off"
          />
        </label>
      </div>
      {!amount.ok ? <p className="svi-field-error">{amount.message}</p> : null}
      <p>
        Pay to any named NEAR account. The VoiceID window shows the exact sentence, for example
        "Send 0.01 NEAR to seams-v1.testnet." Click Record, then read it aloud. In the account
        name, say "dash" for "-" and "dot" for ".".
      </p>
      <p className="svi-hint">
        An accepted payment needs no confirm. A payment above 10 NEAR asks you to confirm again: a
        passkey when you unlocked with your passkey.
      </p>
      <LoadingButton
        onClick={pay}
        loading={outcome.kind === 'working'}
        loadingText="Waiting for your voice..."
        disabled={!canPay}
        style={{ width: '100%' }}
      >
        Pay by voice
      </LoadingButton>
      {outcome.kind === 'result' ? <TransferResult result={outcome.value} /> : null}
      {outcome.kind === 'failed' ? <Notice tone="error">{outcome.message}</Notice> : null}
    </StepCard>
  );
}

function OwnerSteps({ owner }: { owner: Owner }): React.JSX.Element {
  const { seams, walletId, nearAccountId, rpcUrl } = owner;
  const loadAvailability = React.useCallback(
    () => seams.registration.getAuthMethodAvailability({ walletId, method: 'voiceid' }),
    [seams, walletId],
  );
  const loadBalance = React.useCallback(
    () => readFreeBalance(rpcUrl, nearAccountId),
    [nearAccountId, rpcUrl],
  );
  const [availability, reloadAvailability] = useLoaded(loadAvailability);
  const [balance, reloadBalance] = useLoaded(loadBalance);

  const voiceIdOn = availability.kind === 'ready' && availability.value.kind === 'enabled';

  return (
    <>
      <VoiceIdStep owner={owner} availability={availability} onChanged={reloadAvailability} />
      <EnrollStep owner={owner} ready={voiceIdOn} />
      <BalanceStep owner={owner} balance={balance} onRefresh={reloadBalance} />
      <PayStep owner={owner} ready={voiceIdOn} onPaid={reloadBalance} />
    </>
  );
}

type Connection = 'connecting' | 'ready' | 'failed';

/** Loads the Wallet iframe once for this page. */
function useWalletConnection(): Connection {
  const { seams } = useSeams();
  const [connection, setConnection] = React.useState<Connection>('connecting');
  React.useEffect(() => {
    let live = true;
    setConnection('connecting');
    seams.connection.connect().then(
      () => live && setConnection('ready'),
      (error: unknown) => {
        console.error('[seams-voice-intents] The Wallet iframe did not load', error);
        if (live) setConnection('failed');
      },
    );
    return () => {
      live = false;
    };
  }, [seams]);
  return connection;
}

/** The wallet-origin sign-in menu. A new wallet starts with its passkey. */
function SignIn(): React.JSX.Element {
  const [failure, setFailure] = React.useState<string | null>(null);
  const onOutcome = React.useCallback((outcome: HostedAuthMenuOutcome) => {
    setFailure(outcome.kind === 'failed' ? `${outcome.message} (${outcome.code})` : null);
  }, []);
  return (
    <>
      <StepCard index={0} title="Sign in" status="todo">
        <p>
          Sign in to your Seams Wallet with your passkey, or create a wallet. Then this page shows
          your setup.
        </p>
        {failure ? <Notice tone="error">{failure}</Notice> : null}
      </StepCard>
      <div className="svi-signin-menu">
        <HostedSeamsAuthMenu onOutcome={onOutcome} />
      </div>
    </>
  );
}

/** The owner signs in, then walks through the four steps in order. */
export function PaymentFlow({ rpcUrl }: { rpcUrl: string }): React.JSX.Element {
  const connection = useWalletConnection();
  const { seams, loginState } = useSeams();
  const walletId =
    loginState.isLoggedIn && loginState.access === 'wallet' ? loginState.walletId : null;
  const nearAccountId = walletId ? loginState.nearAccountId : null;
  const owner = React.useMemo<Owner | null>(
    () => (walletId && nearAccountId ? { seams, walletId, nearAccountId, rpcUrl } : null),
    [nearAccountId, rpcUrl, seams, walletId],
  );

  if (connection === 'failed') {
    return (
      <Notice tone="error">
        The Wallet did not load. Check the settings in <code>.env.local</code>, then reload the
        page.
      </Notice>
    );
  }
  if (!walletId) return <SignIn />;
  if (!owner) {
    return (
      <Notice tone="info">
        The NEAR account of this wallet is not ready yet. Wait a moment, then reload the page.
      </Notice>
    );
  }
  return <OwnerSteps owner={owner} />;
}
