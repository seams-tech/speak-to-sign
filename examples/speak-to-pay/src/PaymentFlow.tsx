import React from 'react';
import type { SpeakToSignEnrollmentResult, SpeakToSignTransferResult } from '@seams/wallet';
import { HostedSeamsAuthMenu, useSeams, type HostedAuthMenuOutcome } from '@seams/wallet/react';
import {
  DEFAULT_RECEIVER,
  FAUCET_URL,
  PAYMENT_NEED_YOCTO,
  formatNear,
  parseSpokenAmount,
  readFreeBalance,
} from './chain';
import { CopyButton, Fact, LoadingButton, Notice, StepCard, type StepStatus } from './components';
import { useLoaded, useOutcome, useWalletConnection, type Loaded, type Outcome } from './hooks';
import { EnrollmentResult, TransferResult } from './results';

type Seams = ReturnType<typeof useSeams>['seams'];
type Availability = Awaited<ReturnType<Seams['registration']['getAuthMethodAvailability']>>;
type Owner = Readonly<{ seams: Seams; walletId: string; nearAccountId: string; rpcUrl: string }>;

/** The status of a step that checks something: a load, then whether its value is done. */
function loadedStatus<T>(loaded: Loaded<T>, isDone: (value: T) => boolean): StepStatus {
  if (loaded.kind === 'loading') return 'checking';
  if (loaded.kind === 'failed') return 'failed';
  return isDone(loaded.value) ? 'done' : 'todo';
}

/** The status of a step that runs one owner action. A cancel leaves the step to do. */
function stepStatus<T extends Readonly<{ kind: string }>>(
  outcome: Outcome<T>,
  ready: boolean,
  isDone: (value: T) => boolean,
): StepStatus {
  if (outcome.kind === 'working') return 'working';
  if (outcome.kind === 'failed') return 'failed';
  if (outcome.kind === 'idle') return ready ? 'todo' : 'waiting';
  if (isDone(outcome.value)) return 'done';
  return outcome.value.kind === 'cancelled' ? 'todo' : 'failed';
}

/**
 * One step and one set of recordings: the Wallet turns on VoiceID if this wallet has none, and
 * the same three recordings enroll the verifier. A VoiceID that the owner turned off comes back
 * on first.
 */
function VoiceStep(props: {
  owner: Owner;
  availability: Loaded<Availability>;
  onChanged: () => void;
}): React.JSX.Element {
  const { owner, availability, onChanged } = props;
  const [outcome, start] = useOutcome<SpeakToSignEnrollmentResult>();
  const turnedOff = availability.kind === 'ready' && availability.value.kind === 'disabled';
  const setUp = React.useCallback(async () => {
    await start(async () => {
      const speakToSign = owner.seams.speakToSign;
      if (!speakToSign) throw new Error('Speak-to-Sign is not configured.');
      if (turnedOff) {
        await owner.seams.registration.setAuthMethodEnabled({
          walletId: owner.walletId,
          method: 'voiceid',
          enabled: true,
        });
      }
      return await speakToSign.enroll({ walletId: owner.walletId });
    });
    onChanged();
  }, [onChanged, owner, start, turnedOff]);
  const status = stepStatus(
    outcome,
    availability.kind === 'ready',
    (result) => result.kind === 'enrolled',
  );

  return (
    <StepCard index={1} title="Set up your voice" status={status}>
      {availability.kind === 'failed' ? <Notice tone="error">{availability.message}</Notice> : null}
      <p>
        The Wallet shows three short phrases, one at a time. Read each one aloud. The same
        recordings turn on VoiceID on this device and give the verifier a template of your voice.
        Then confirm one signed message that names exactly these recordings.
      </p>
      <p className="svi-hint">
        You must be unlocked with your passkey. If you set up your voice with this version before,
        you can skip this step. A new enrollment replaces the template.
      </p>
      <LoadingButton
        onClick={setUp}
        loading={outcome.kind === 'working'}
        loadingText="Setting up..."
        disabled={availability.kind !== 'ready'}
        style={{ width: '100%' }}
      >
        {turnedOff ? 'Turn VoiceID on again and set up' : 'Set up my voice'}
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
  const status = loadedStatus(balance, (value) => value !== null && value >= PAYMENT_NEED_YOCTO);

  return (
    <StepCard index={2} title="Check your balance" status={status}>
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

function PayStep(props: { owner: Owner; ready: boolean; onPaid: () => void }): React.JSX.Element {
  const { owner, ready, onPaid } = props;
  const [amountText, setAmountText] = React.useState('1');
  const [receiver, setReceiver] = React.useState(DEFAULT_RECEIVER);
  const chosen = receiver.trim();
  const amount = parseSpokenAmount(amountText);
  const [outcome, start] = useOutcome<SpeakToSignTransferResult>();
  const pay = React.useCallback(async () => {
    if (!amount.ok || !chosen) return;
    const result = await start(async () => {
      const speakToSign = owner.seams.speakToSign;
      if (!speakToSign) throw new Error('Speak-to-Sign is not configured.');
      return await speakToSign.requestTransfer({
        walletId: owner.walletId,
        receiver: chosen,
        amount: amount.amount,
      });
    });
    if (result?.kind === 'sent') onPaid();
  }, [amount, chosen, onPaid, owner, start]);
  const canPay = ready && amount.ok && Boolean(chosen) && outcome.kind !== 'working';
  const status = stepStatus(outcome, ready, (result) => result.kind === 'sent');

  return (
    <StepCard index={3} title="Pay by voice" status={status}>
      {!ready ? <Notice tone="info">Set up your voice first.</Notice> : null}
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
        "Send 1 NEAR to seams-v1.testnet." Click Record, then read it aloud. In the account name,
        you can say "dash" and "dot", or leave them out: "seams v one" is enough.
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
      <VoiceStep owner={owner} availability={availability} onChanged={reloadAvailability} />
      <BalanceStep owner={owner} balance={balance} onRefresh={reloadBalance} />
      <PayStep owner={owner} ready={voiceIdOn} onPaid={reloadBalance} />
    </>
  );
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
