// The spoken payment and spoken note flows of the host plugin, against a fake Wallet core.
// The Wallet's own side (the request bytes, the verdict check and the core host operations)
// is tested in seams-wallet (tests/unit/speakToSignHost.unit.test.ts).

import { createHash } from 'node:crypto';
import { expect, test } from '@playwright/test';
import type {
  SpeakToSignHostOperations,
  SpeakToSignPayment,
  SpeakToSignPrompt,
  SpokenNoteAction,
} from '@seams/wallet/speak-to-sign-host';
import { runSpokenNote, runSpokenTransfer, type HostTransfer } from '../src/host/flow';

type ClipRequest = Parameters<SpeakToSignHostOperations['openPrompt']>[0];
type Clip = Awaited<ReturnType<SpeakToSignPrompt['record']>>;
type PhraseView = Parameters<SpeakToSignPrompt['show']>[0];
type PhraseChoice = Awaited<ReturnType<SpeakToSignPrompt['show']>>;
type VerifyReply = Awaited<ReturnType<SpeakToSignHostOperations['verify']>>;

/** The flow sends the recorded bytes as they are, so any bytes stand for a recording. */
function clip(): Extract<Clip, { kind: 'captured' }> {
  return {
    kind: 'captured',
    wav: Uint8Array.from({ length: 64 }, (_, index) => index),
    speechMs: 2_000,
    endOfSpeechAt: 0,
  };
}

type FakeCore = {
  operations: SpeakToSignHostOperations;
  sentences: string[];
  verifyInputs: Array<Readonly<Record<string, unknown>>>;
  payments: Array<{ receiver: string; amountYocto: bigint; output: unknown }>;
  notes: Array<{ action: SpokenNoteAction; output: unknown }>;
  /** Each view the flow showed, as `kind:label:headline or caption`. */
  views: string[];
  closed: number;
};

function fakeCore(input: {
  reply?: VerifyReply;
  payment?: SpeakToSignPayment;
  /** Payments after the first one, for a flow that records again. */
  payments?: readonly SpeakToSignPayment[];
  missing?: readonly string[];
  clip?: Clip;
  /** The owner's answers to result views, in order. The default closes the card. */
  choices?: PhraseChoice[];
}): FakeCore {
  const choices = [...(input.choices ?? [])];
  const payments = [...(input.payments ?? [])];
  const core: FakeCore = {
    sentences: [],
    verifyInputs: [],
    payments: [],
    notes: [],
    views: [],
    closed: 0,
    operations: {
      async openPrompt(request: ClipRequest) {
        core.sentences.push(request.sentence);
        return {
          kind: 'opened',
          prompt: {
            record: async () => input.clip ?? clip(),
            show: async (view: PhraseView) => {
              core.views.push(viewName(view));
              return view.kind === 'check' ? 'replaced' : (choices.shift() ?? 'closed');
            },
            close: () => {
              core.closed += 1;
            },
          },
        };
      },
      async receiverExists(accountId) {
        return !input.missing?.includes(accountId);
      },
      async verify(verifierInput) {
        core.verifyInputs.push(verifierInput);
        return input.reply ?? { kind: 'output', output: { verdict: 'opaque' } };
      },
      async payWithVerdict(transfer, output, _signal, hooks) {
        const payment =
          (core.payments.length > 0 ? payments.shift() : undefined) ??
          input.payment ??
          ({ kind: 'executed', transactionHash: 'tx-hash', approval: 'voice' } as const);
        core.payments.push({ ...transfer, output });
        if (payment.kind === 'executed' && payment.approval === 'voice') hooks.accepted();
        if (payment.kind === 'executed' && payment.approval === 'voice_and_passkey') {
          if (!(await hooks.approveStepUp('A voice payment above 10 NEAR needs a passkey.'))) {
            return { kind: 'cancelled' };
          }
          hooks.broadcasting();
        }
        return payment;
      },
      async signNoteWithVerdict(action, output, _signal, hooks) {
        core.notes.push({ action, output });
        const payment =
          input.payment ?? ({ kind: 'executed', transactionHash: 'tx-note', approval: 'voice' } as const);
        if (payment.kind === 'executed') hooks.accepted();
        return payment;
      },
      async authorizeEnrollment() {
        throw new Error('A spoken payment authorizes no enrollment.');
      },
    },
  };
  return core;
}

function viewName(view: PhraseView): string {
  return view.kind === 'check'
    ? `check:${view.caption}`
    : `result:${view.label}:${view.headline}:${view.action.label}`;
}

function hostTransfer(core: FakeCore, overrides: Partial<HostTransfer> = {}): HostTransfer {
  return {
    ownerAccountId: 'owner.testnet',
    receiver: 'alice.testnet',
    amount: '25',
    surfaceMeasurementBinding: { kind: 'disabled' },
    operations: core.operations,
    ...overrides,
  };
}

function transferInput(transfer: HostTransfer) {
  return {
    walletId: 'owner.testnet' as never,
    network: 'testnet' as const,
    signal: new AbortController().signal,
    transfer,
  };
}

test('a spoken payment verifies the typed transfer and lets core pay with the verdict', async () => {
  const core = fakeCore({});
  const result = await runSpokenTransfer(transferInput(hostTransfer(core)));
  expect(result).toMatchObject({ kind: 'sent', transactionHash: 'tx-hash', approval: 'voice' });
  expect(core.sentences).toEqual(['Send 25 NEAR to alice.testnet']);
  expect(core.verifyInputs).toEqual([
    {
      op: 'verify',
      owner: 'owner.testnet',
      request: {
        kind: 'transfer',
        receiver: 'alice.testnet',
        amount_yocto: '25000000000000000000000000',
      },
      contacts: [],
      audio_wav_b64: Buffer.from(clip().wav).toString('base64'),
    },
  ]);
  expect(core.payments).toEqual([
    { receiver: 'alice.testnet', amountYocto: 25n * 10n ** 24n, output: { verdict: 'opaque' } },
  ]);

  expect(core.views).toEqual([
    'check:Checking your voice and words',
    'check:Sending from your account',
    'result::Sent 25 NEAR:Done',
  ]);
  expect(core.closed).toBe(1);

  const stepUp = fakeCore({
    payment: { kind: 'executed', transactionHash: 'tx-2', approval: 'voice_and_passkey' },
    choices: ['action'],
  });
  expect(await runSpokenTransfer(transferInput(hostTransfer(stepUp)))).toMatchObject({
    kind: 'sent',
    approval: 'voice_and_passkey',
  });
  expect(stepUp.views).toEqual([
    'check:Checking your voice and words',
    'result:Not sent yet:Confirm with your passkey:Confirm with passkey',
    'result:Not sent yet:Confirm with your passkey:Confirm with passkey',
    'check:Sending from your account',
    'result::Sent 25 NEAR:Done',
  ]);

  // Closing the step-up question signs nothing.
  const declined = fakeCore({
    payment: { kind: 'executed', transactionHash: 'tx-3', approval: 'voice_and_passkey' },
  });
  expect(await runSpokenTransfer(transferInput(hostTransfer(declined)))).toEqual({
    kind: 'cancelled',
  });
});

test('a refusal shows on the card, and "Try again" records the sentence again', async () => {
  const core = fakeCore({
    payment: { kind: 'refused', reason: 'words', detail: 'heard: send 0.1 near to alice.testnet' },
    payments: [{ kind: 'executed', transactionHash: 'tx-4', approval: 'voice' }],
    choices: ['action'],
  });
  expect(await runSpokenTransfer(transferInput(hostTransfer(core)))).toMatchObject({
    kind: 'sent',
    transactionHash: 'tx-4',
  });
  expect(core.views).toEqual([
    'check:Checking your voice and words',
    'result:Nothing was sent:The words did not match:Try again',
    'check:Checking your voice and words',
    'check:Sending from your account',
    'result::Sent 25 NEAR:Done',
  ]);
  expect(core.verifyInputs).toHaveLength(2);
  expect(core.closed).toBe(1);
});

test('a payment records at most five times, then the refusal offers only Close', async () => {
  const core = fakeCore({
    payment: { kind: 'refused', reason: 'speaker' },
    choices: ['action', 'action', 'action', 'action', 'action', 'action'],
  });
  expect(await runSpokenTransfer(transferInput(hostTransfer(core)))).toEqual({
    kind: 'refused',
    reason: 'speaker',
  });
  expect(core.verifyInputs).toHaveLength(5);
  expect(core.views.filter((view) => view.startsWith('result:'))).toEqual([
    ...Array.from(
      { length: 4 },
      () => 'result:Nothing was sent:Your voice did not match:Try again',
    ),
    'result:Nothing was sent:Your voice did not match:Close',
  ]);
});

test('the words that the verifier heard are aligned with the sentence and marked', async () => {
  const core = fakeCore({
    payment: {
      kind: 'refused',
      reason: 'words',
      detail: 'heard: send twenty year to alice dot testnet <b>',
    },
  });
  const transfer = hostTransfer(core);
  let caption: unknown = null;
  const opened = await core.operations.openPrompt({
    sentence: '',
    signal: new AbortController().signal,
    surfaceMeasurementBinding: { kind: 'disabled' },
  });
  if (opened.kind !== 'opened') throw new Error('not opened');
  const operations = {
    ...core.operations,
    openPrompt: async () => ({
      kind: 'opened' as const,
      prompt: {
        ...opened.prompt,
        show: async (view: PhraseView) => {
          if (view.kind === 'result') caption = view.caption;
          return 'closed' as const;
        },
      },
    }),
  };
  await runSpokenTransfer(transferInput({ ...transfer, operations }));
  // The sentence says "send twenty five near to alice dot testnet".
  expect(caption).toEqual([
    'We heard “',
    'send',
    ' ',
    'twenty',
    ' ',
    { mark: 'year' },
    ' ',
    'to',
    ' ',
    'alice',
    ' ',
    'dot',
    ' ',
    'testnet',
    ' ',
    { mark: '<b>' },
    '”',
  ]);
});

test('nothing is paid for a bad request, a missing receiver, a refusal or a failed route', async () => {
  const cases: Array<
    [string, Parameters<typeof fakeCore>[0], Partial<HostTransfer>, Record<string, unknown>]
  > = [
    ['implicit receiver', {}, { receiver: 'a'.repeat(64) }, { reason: 'receiver_not_speakable' }],
    [
      'missing receiver',
      { missing: ['carol.testnet'] },
      { receiver: 'carol.testnet' },
      { kind: 'refused', reason: 'receiver_missing' },
    ],
    ['unspeakable amount', {}, { amount: '0.001' }, { reason: 'amount_not_speakable' }],
    [
      'verify route failure',
      { reply: { kind: 'failed', code: 'verifier_timeout' } },
      {},
      { kind: 'unavailable', reason: 'verifier_unavailable', detail: 'verifier_timeout' },
    ],
  ];
  for (const [name, coreInput, overrides, expected] of cases) {
    const core = fakeCore(coreInput);
    const result = await runSpokenTransfer(transferInput(hostTransfer(core, overrides)));
    expect(result, name).toMatchObject(expected);
    expect(core.payments, name).toEqual([]);
  }
});

test('core refusals, a failed transfer and recording problems map to results', async () => {
  const outcomes: Array<[SpeakToSignPayment, object]> = [
    [
      { kind: 'refused', reason: 'verdict_mismatch', detail: 'request_digest differs' },
      { kind: 'refused', reason: 'verdict_mismatch', detail: 'request_digest differs' },
    ],
    [{ kind: 'refused', reason: 'speaker' }, { kind: 'refused', reason: 'speaker' }],
    [
      { kind: 'reverted', transactionHash: 'tx', error: 'NotEnoughBalance' },
      { kind: 'refused', reason: 'transaction_failed', detail: 'NotEnoughBalance' },
    ],
    [
      { kind: 'not_submitted', error: 'closed' },
      { kind: 'unavailable', reason: 'not_submitted', detail: 'closed' },
    ],
    [
      { kind: 'refused', reason: 'voice_limit', detail: 'over_daily_limit' },
      { kind: 'refused', reason: 'voice_limit', detail: 'over_daily_limit' },
    ],
    [
      { kind: 'refused', reason: 'cosigner_refused', detail: 'reused' },
      { kind: 'refused', reason: 'cosigner_refused', detail: 'reused' },
    ],
    [
      { kind: 'unavailable', detail: 'This network has no verifier.' },
      {
        kind: 'unavailable',
        reason: 'verifier_unavailable',
        detail: 'This network has no verifier.',
      },
    ],
  ];
  for (const [payment, expected] of outcomes) {
    const core = fakeCore({ payment });
    expect(await runSpokenTransfer(transferInput(hostTransfer(core))), payment.kind).toEqual(
      expected,
    );
  }
  // The card names the co-signer's refusals. Over the limit, another recording cannot help.
  const limited = fakeCore({
    payment: { kind: 'refused', reason: 'voice_limit', detail: 'over_daily_limit' },
  });
  await runSpokenTransfer(transferInput(hostTransfer(limited)));
  expect(limited.views.at(-1)).toBe('result:Nothing was sent:Over your voice limit:Close');
  const refused = fakeCore({
    payment: { kind: 'refused', reason: 'cosigner_refused', detail: 'reused' },
  });
  await runSpokenTransfer(transferInput(hostTransfer(refused)));
  expect(refused.views.at(-1)).toBe('result:Nothing was sent:Seams refused the verdict:Try again');

  const cancelled = fakeCore({ clip: { kind: 'cancelled' } });
  expect(await runSpokenTransfer(transferInput(hostTransfer(cancelled)))).toEqual({
    kind: 'cancelled',
  });
  expect(cancelled.verifyInputs).toEqual([]);
  const missing = fakeCore({
    clip: { kind: 'unavailable', detail: 'VoiceID is missing from this Wallet host.' },
  });
  expect(await runSpokenTransfer(transferInput(hostTransfer(missing)))).toEqual({
    kind: 'unavailable',
    reason: 'voiceid_unavailable',
    detail: 'VoiceID is missing from this Wallet host.',
  });
});

const NOTE: SpokenNoteAction = {
  kind: 'community_note',
  contract: 'community-notes.testnet',
  postId: 7n,
  text: 'The city closes one lane for two weeks of repairs.',
  summary: 'Only one lane closes for two weeks.',
};

test('a spoken note verifies the summary and lets core sign the note', async () => {
  const core = fakeCore({});
  const result = await runSpokenNote({
    walletId: 'owner.testnet' as never,
    network: 'testnet',
    signal: new AbortController().signal,
    note: {
      ownerAccountId: 'owner.testnet',
      action: NOTE,
      surfaceMeasurementBinding: { kind: 'disabled' },
      operations: core.operations,
    },
  });
  expect(result).toMatchObject({ kind: 'sent', transactionHash: 'tx-note', approval: 'voice' });
  expect(core.sentences).toEqual(['Only one lane closes for two weeks.']);
  expect(core.verifyInputs[0]?.request).toEqual({
    kind: 'community_note',
    contract: 'community-notes.testnet',
    post_id: 7,
    note_sha256_hex: createHash('sha256').update(NOTE.text).digest('hex'),
    summary: NOTE.summary,
  });
  expect(core.notes).toEqual([{ action: NOTE, output: { verdict: 'opaque' } }]);
  expect(core.views.at(-1)).toBe('result::Note posted:Done');

  const unspeakable = fakeCore({});
  expect(
    await runSpokenNote({
      walletId: 'owner.testnet' as never,
      network: 'testnet',
      signal: new AbortController().signal,
      note: {
        ownerAccountId: 'owner.testnet',
        action: { ...NOTE, summary: 'Closed for 6 months' },
        surfaceMeasurementBinding: { kind: 'disabled' },
        operations: unspeakable.operations,
      },
    }),
  ).toEqual({ kind: 'refused', reason: 'summary_not_speakable' });
  expect(unspeakable.sentences).toEqual([]);
});
