// A fake Wallet core for the flows of the host plugin. It records each prompt, view and core
// call in order. The Wallet's own side (the request bytes, the verdict check and the core host
// operations) is tested in seams-wallet (tests/unit/speakToSignHost.unit.test.ts).

import type {
  SpeakToSignHostOperations,
  SpeakToSignNoteSigning,
  SpeakToSignPayment,
  SpeakToSignPrompt,
  SpokenNoteAction,
} from '@seams/wallet/speak-to-sign-host';

type Clip = Awaited<ReturnType<SpeakToSignPrompt['record']>>;
type PhraseView = Parameters<SpeakToSignPrompt['show']>[0];
type PhraseChoice = Awaited<ReturnType<SpeakToSignPrompt['show']>>;
type VerifyReply = Awaited<ReturnType<SpeakToSignHostOperations['verify']>>;
type MessageAction = Parameters<SpeakToSignHostOperations['signMessageWithVerdict']>[0];
type Authorization = Awaited<ReturnType<SpeakToSignHostOperations['authorizeEnrollment']>>;

/** The flow sends the recorded bytes as they are, so distinct bytes stand for each recording. */
export function clip(index = 1): Extract<Clip, { kind: 'captured' }> {
  return {
    kind: 'captured',
    wav: Uint8Array.from({ length: 64 }, (_, at) => (at * index) % 256),
    speechMs: 2_000,
    endOfSpeechAt: 0,
  };
}

/** The verifier output. The plugin hands it to core unread, so any value stands for one. */
export function verifierOutput(output: unknown = { verdict: 'opaque' }): VerifyReply {
  return { kind: 'output', output };
}

/** The Seams verify route did not answer usefully. */
export function routeFailure(code: string): VerifyReply {
  return { kind: 'failed', code };
}

export type FakeHostOptions = {
  /** Each recording, in order. The default for the nth recording is `clip(n)`. */
  clips?: readonly Clip[];
  /** The owner's answers to result views, in order. The default closes the card. */
  choices?: readonly PhraseChoice[];
  /** The reply of the verify route to each call. The default is `verifierOutput()`. */
  reply?: VerifyReply;
  /** Core's outcome of each payment or note, in order. The default sends it on the voice alone. */
  outcomes?: readonly SpeakToSignPayment[];
  /** Core's outcome of each note action that is not a payment: a signature that it did not send. */
  signatures?: readonly SpeakToSignNoteSigning[];
  /** The accounts that do not exist on the network. */
  missing?: readonly string[];
  /** Core's enrollment authorization. A flow that asks for one without it fails. */
  authorization?: Authorization;
  /** An enrollment flow: core throws for a receiver check, a payment or a note. */
  enrollment?: boolean;
};

export type FakeHost = {
  operations: SpeakToSignHostOperations;
  /** The sentence of each prompt, in order. */
  sentences: string[];
  /**
   * What happened on each card and in core, in order: `open <n>`, `record <n>`,
   * `show <n>: <check caption or result headline>` and `close <n>` for the nth prompt, and
   * `receiver <account>`, `verify`, `pay`, `sign note`, `sign message` and `authorize` for core.
   */
  events: string[];
  /** Each view, as `check:<caption>` or `result:<label>:<headline>:<action label>`. */
  views: string[];
  /** The caption of each result view, in order. */
  captions: unknown[];
  closed: number;
  verifyInputs: Array<Readonly<Record<string, unknown>>>;
  payments: Array<{ receiver: string; amountYocto: bigint; output: unknown }>;
  notes: Array<{ action: SpokenNoteAction; output: unknown }>;
  messages: Array<{ action: MessageAction; output: unknown }>;
  authorized: Array<readonly Uint8Array[]>;
};

export function fakeHost(options: FakeHostOptions = {}): FakeHost {
  const clips = [...(options.clips ?? [])];
  const choices = [...(options.choices ?? [])];
  const outcomes = [...(options.outcomes ?? [])];
  const signatures = [...(options.signatures ?? [])];
  let recordings = 0;
  const host: FakeHost = {
    sentences: [],
    events: [],
    views: [],
    captions: [],
    closed: 0,
    verifyInputs: [],
    payments: [],
    notes: [],
    messages: [],
    authorized: [],
    operations: {
      async openPrompt(request) {
        host.sentences.push(request.sentence);
        const index = host.sentences.length;
        host.events.push(`open ${index}`);
        return {
          kind: 'opened',
          prompt: {
            record: async () => {
              host.events.push(`record ${index}`);
              recordings += 1;
              return clips.shift() ?? clip(recordings);
            },
            show: async (view) => {
              host.events.push(
                `show ${index}: ${view.kind === 'check' ? view.caption : view.headline}`,
              );
              host.views.push(viewName(view));
              if (view.kind === 'result') host.captions.push(view.caption);
              return view.kind === 'check' ? 'replaced' : (choices.shift() ?? 'closed');
            },
            close: () => {
              host.events.push(`close ${index}`);
              host.closed += 1;
            },
          },
        };
      },
      async receiverExists(accountId) {
        if (options.enrollment) throw new Error('An enrollment checks no receiver.');
        host.events.push(`receiver ${accountId}`);
        return !options.missing?.includes(accountId);
      },
      async verify(verifierInput) {
        host.events.push('verify');
        host.verifyInputs.push(verifierInput);
        return options.reply ?? verifierOutput();
      },
      async payWithVerdict(transfer, output, _signal, hooks) {
        if (options.enrollment) throw new Error('An enrollment pays nothing.');
        host.events.push('pay');
        host.payments.push({ ...transfer, output });
        const payment =
          outcomes.shift() ??
          ({ kind: 'executed', transactionHash: 'tx-hash', approval: 'voice' } as const);
        if (payment.kind === 'executed' && payment.approval === 'voice') hooks.accepted();
        if (payment.kind === 'executed' && payment.approval === 'voice_and_passkey') {
          if (!(await hooks.approveStepUp('A voice payment above 10 NEAR needs a passkey.'))) {
            return { kind: 'cancelled' };
          }
          hooks.broadcasting();
        }
        // Core tells the card when a block holds a plain transfer, before the outcome.
        if (payment.kind === 'executed') hooks.included(payment.transactionHash);
        return payment;
      },
      async signNoteWithVerdict(action, output, _signal, hooks) {
        if (options.enrollment) throw new Error('An enrollment signs no note.');
        host.events.push('sign note');
        host.notes.push({ action, output });
        const payment =
          signatures.shift() ??
          outcomes.shift() ??
          ({ kind: 'executed', transactionHash: 'tx-note', approval: 'voice' } as const);
        if (payment.kind !== 'refused' && payment.kind !== 'unavailable') hooks.accepted();
        return payment;
      },
      async signMessageWithVerdict(action, output, _signal, hooks) {
        if (options.enrollment) throw new Error('An enrollment signs no message.');
        host.events.push('sign message');
        host.messages.push({ action, output });
        hooks.accepted();
        return {
          kind: 'signed',
          approval: 'voice',
          accountId: 'owner.testnet',
          publicKey: 'ed25519:owner',
          signature: 'c2lnbmF0dXJl',
          nonce: action.nonce,
        };
      },
      async authorizeEnrollment(recorded) {
        host.events.push('authorize');
        host.authorized.push(recorded);
        if (!options.authorization) throw new Error('This test authorizes no enrollment.');
        return options.authorization;
      },
    },
  };
  return host;
}

function viewName(view: PhraseView): string {
  return view.kind === 'check'
    ? `check:${view.caption}`
    : `result:${view.label}:${view.headline}:${view.action.label}`;
}
