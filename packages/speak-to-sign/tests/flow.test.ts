// The spoken payment and spoken note flows of the host plugin, against a fake Wallet core
// (tests/fakeHost.ts).

import { createHash } from 'node:crypto';
import { expect, test } from '@playwright/test';
import type { SpeakToSignPayment, SpokenNoteAction } from '@seams/wallet/speak-to-sign-host';
import {
  runSpokenMessage,
  runSpokenNote,
  runSpokenTransfer,
  type HostTransfer,
} from '../src/host/flow';
import { heardCaption } from '../src/host/heardWords';
import { clip, fakeHost, routeFailure, type FakeHost, type FakeHostOptions } from './fakeHost';

function transferInput(
  host: FakeHost,
  overrides: Partial<HostTransfer> = {},
): Parameters<typeof runSpokenTransfer>[0] {
  return {
    network: 'testnet',
    signal: new AbortController().signal,
    transfer: {
      ownerAccountId: 'owner.testnet',
      receiver: 'alice.testnet',
      amount: '25',
      surfaceMeasurementBinding: { kind: 'disabled' },
      operations: host.operations,
      ...overrides,
    },
  };
}

const NOTE: SpokenNoteAction = {
  kind: 'community_note',
  contract: 'community-notes.testnet',
  postId: 7n,
  text: 'The city closes one lane for two weeks of repairs.',
  summary: 'Only one lane closes for two weeks.',
};

function noteInput(host: FakeHost, action: SpokenNoteAction): Parameters<typeof runSpokenNote>[0] {
  return {
    network: 'testnet',
    signal: new AbortController().signal,
    note: {
      ownerAccountId: 'owner.testnet',
      action,
      surfaceMeasurementBinding: { kind: 'disabled' },
      operations: host.operations,
    },
  };
}

test('a spoken payment verifies the typed transfer and lets core pay with the verdict', async () => {
  const host = fakeHost();
  const result = await runSpokenTransfer(transferInput(host));
  expect(result).toMatchObject({ kind: 'sent', transactionHash: 'tx-hash', approval: 'voice' });
  expect(host.sentences).toEqual(['Send 25 NEAR to alice.testnet']);
  expect(host.verifyInputs).toEqual([
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
  expect(host.payments).toEqual([
    { receiver: 'alice.testnet', amountYocto: 25n * 10n ** 24n, output: { verdict: 'opaque' } },
  ]);

  expect(host.views).toEqual([
    'check:Checking your voice and words',
    'check:Sending from your account',
    'result::Sent 25 NEAR:Done',
  ]);
  expect(host.closed).toBe(1);
});

test('a step-up asks for the passkey on the card, then pays', async () => {
  const host = fakeHost({
    outcomes: [{ kind: 'executed', transactionHash: 'tx-2', approval: 'voice_and_passkey' }],
    choices: ['action'],
  });
  expect(await runSpokenTransfer(transferInput(host))).toMatchObject({
    kind: 'sent',
    approval: 'voice_and_passkey',
  });
  expect(host.views).toEqual([
    'check:Checking your voice and words',
    'result:Not sent yet:Confirm with your passkey:Confirm with passkey',
    'result:Not sent yet:Confirm with your passkey:Confirm with passkey',
    'check:Sending from your account',
    'result::Sent 25 NEAR:Done',
  ]);
});

test('closing the step-up question signs nothing', async () => {
  const host = fakeHost({
    outcomes: [{ kind: 'executed', transactionHash: 'tx-3', approval: 'voice_and_passkey' }],
  });
  expect(await runSpokenTransfer(transferInput(host))).toEqual({ kind: 'cancelled' });
});

test('a refusal shows on the card, and "Try again" records the sentence again', async () => {
  const host = fakeHost({
    outcomes: [
      { kind: 'refused', reason: 'words', detail: 'heard: send 0.1 near to alice.testnet' },
      { kind: 'executed', transactionHash: 'tx-4', approval: 'voice' },
    ],
    choices: ['action'],
  });
  expect(await runSpokenTransfer(transferInput(host))).toMatchObject({
    kind: 'sent',
    transactionHash: 'tx-4',
  });
  expect(host.views).toEqual([
    'check:Checking your voice and words',
    'result:Nothing was sent:The words did not match:Try again',
    'check:Checking your voice and words',
    'check:Sending from your account',
    'result::Sent 25 NEAR:Done',
  ]);
  expect(host.verifyInputs).toHaveLength(2);
  expect(host.closed).toBe(1);
});

test('a payment records at most five times, then the refusal offers only Close', async () => {
  const host = fakeHost({
    outcomes: Array.from({ length: 5 }, () => ({ kind: 'refused', reason: 'speaker' }) as const),
    choices: ['action', 'action', 'action', 'action', 'action', 'action'],
  });
  expect(await runSpokenTransfer(transferInput(host))).toEqual({
    kind: 'refused',
    reason: 'speaker',
  });
  expect(host.verifyInputs).toHaveLength(5);
  expect(host.views.filter((view) => view.startsWith('result:'))).toEqual([
    ...Array.from(
      { length: 4 },
      () => 'result:Nothing was sent:Your voice did not match:Try again',
    ),
    'result:Nothing was sent:Your voice did not match:Close',
  ]);
});

test('the words that the verifier heard are aligned with the sentence and marked', () => {
  const caption = heardCaption(
    'send twenty five near to alice dot testnet',
    'heard: send twenty year to alice dot testnet <b>',
  );
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

test('a words refusal shows the words that the verifier heard on the result card', async () => {
  const detail = 'heard: send twenty year to alice dot testnet <b>';
  const host = fakeHost({ outcomes: [{ kind: 'refused', reason: 'words', detail }] });
  await runSpokenTransfer(transferInput(host));
  expect(host.captions).toEqual([
    heardCaption('send twenty five near to alice dot testnet', detail),
  ]);
});

const NOT_PAID: Array<[string, FakeHostOptions, Partial<HostTransfer>, Record<string, unknown>]> =
  [
    [
      'an implicit receiver',
      {},
      { receiver: 'a'.repeat(64) },
      { reason: 'receiver_not_speakable' },
    ],
    [
      'a missing receiver',
      { missing: ['carol.testnet'] },
      { receiver: 'carol.testnet' },
      { kind: 'refused', reason: 'receiver_missing' },
    ],
    ['an unspeakable amount', {}, { amount: '0.001' }, { reason: 'amount_not_speakable' }],
    [
      'a failure of the verify route',
      { reply: routeFailure('verifier_timeout') },
      {},
      { kind: 'unavailable', reason: 'verifier_unavailable', detail: 'verifier_timeout' },
    ],
  ];

for (const [name, options, overrides, expected] of NOT_PAID) {
  test(`nothing is paid for ${name}`, async () => {
    const host = fakeHost(options);
    const result = await runSpokenTransfer(transferInput(host, overrides));
    expect(result).toMatchObject(expected);
    expect(host.payments).toEqual([]);
  });
}

const CORE_OUTCOMES: Array<[string, SpeakToSignPayment, object]> = [
  [
    'a verdict mismatch',
    { kind: 'refused', reason: 'verdict_mismatch', detail: 'request_digest differs' },
    { kind: 'refused', reason: 'verdict_mismatch', detail: 'request_digest differs' },
  ],
  [
    'a verifier refusal',
    { kind: 'refused', reason: 'speaker' },
    { kind: 'refused', reason: 'speaker' },
  ],
  [
    'a failed transfer',
    { kind: 'reverted', transactionHash: 'tx', error: 'NotEnoughBalance' },
    { kind: 'refused', reason: 'transaction_failed', detail: 'NotEnoughBalance' },
  ],
  [
    'a transfer that was not sent',
    { kind: 'not_submitted', error: 'closed' },
    { kind: 'unavailable', reason: 'not_submitted', detail: 'closed' },
  ],
  [
    'the voice limit',
    { kind: 'refused', reason: 'voice_limit', detail: 'over_daily_limit' },
    { kind: 'refused', reason: 'voice_limit', detail: 'over_daily_limit' },
  ],
  [
    'a co-signer refusal',
    { kind: 'refused', reason: 'cosigner_refused', detail: 'reused' },
    { kind: 'refused', reason: 'cosigner_refused', detail: 'reused' },
  ],
  [
    'a network with no verifier',
    { kind: 'unavailable', detail: 'This network has no verifier.' },
    {
      kind: 'unavailable',
      reason: 'verifier_unavailable',
      detail: 'This network has no verifier.',
    },
  ],
];

for (const [name, outcome, expected] of CORE_OUTCOMES) {
  test(`${name} from core maps to its result`, async () => {
    const host = fakeHost({ outcomes: [outcome] });
    expect(await runSpokenTransfer(transferInput(host))).toEqual(expected);
  });
}

test('over the voice limit, the card offers only Close', async () => {
  // Over the limit, another recording cannot help.
  const host = fakeHost({
    outcomes: [{ kind: 'refused', reason: 'voice_limit', detail: 'over_daily_limit' }],
  });
  await runSpokenTransfer(transferInput(host));
  expect(host.views.at(-1)).toBe('result:Nothing was sent:Over your voice limit:Close');
});

test('the card names a refusal of the co-signer', async () => {
  const host = fakeHost({
    outcomes: [{ kind: 'refused', reason: 'cosigner_refused', detail: 'reused' }],
  });
  await runSpokenTransfer(transferInput(host));
  expect(host.views.at(-1)).toBe('result:Nothing was sent:Seams refused the verdict:Try again');
});

test('a cancelled recording goes to no verifier', async () => {
  const host = fakeHost({ clips: [{ kind: 'cancelled' }] });
  expect(await runSpokenTransfer(transferInput(host))).toEqual({ kind: 'cancelled' });
  expect(host.verifyInputs).toEqual([]);
});

test('a recording that VoiceID cannot make is unavailable', async () => {
  const host = fakeHost({
    clips: [{ kind: 'unavailable', detail: 'VoiceID is missing from this Wallet host.' }],
  });
  expect(await runSpokenTransfer(transferInput(host))).toEqual({
    kind: 'unavailable',
    reason: 'voiceid_unavailable',
    detail: 'VoiceID is missing from this Wallet host.',
  });
});

test('a spoken note verifies the summary and lets core sign the note', async () => {
  const host = fakeHost();
  const result = await runSpokenNote(noteInput(host, NOTE));
  expect(result).toMatchObject({ kind: 'sent', transactionHash: 'tx-note', approval: 'voice' });
  expect(host.sentences).toEqual(['Only one lane closes for two weeks.']);
  expect(host.verifyInputs[0]?.request).toEqual({
    kind: 'community_note',
    contract: 'community-notes.testnet',
    post_id: 7,
    note_sha256_hex: createHash('sha256').update(NOTE.text).digest('hex'),
    summary: NOTE.summary,
  });
  expect(host.notes).toEqual([{ action: NOTE, output: { verdict: 'opaque' } }]);
  expect(host.views.at(-1)).toBe('result::Note posted:Done');
});

test('a note with an unspeakable summary is refused before a prompt opens', async () => {
  const host = fakeHost();
  expect(await runSpokenNote(noteInput(host, { ...NOTE, summary: 'Closed for 6 months' }))).toEqual(
    { kind: 'refused', reason: 'summary_not_speakable' },
  );
  expect(host.sentences).toEqual([]);
});

test('a spoken message verifies the summary and lets core sign the message', async () => {
  const host = fakeHost();
  const action = {
    message: 'Log in to example.app',
    recipient: 'example.app',
    nonce: 'BQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQU=',
    callbackUrl: null,
    state: null,
    payloadSha256: new Uint8Array(32).fill(0x41),
    summary: 'Log in to the example app',
  };
  const result = await runSpokenMessage({
    network: 'testnet',
    signal: new AbortController().signal,
    message: {
      ownerAccountId: 'owner.testnet',
      action,
      surfaceMeasurementBinding: { kind: 'disabled' },
      operations: host.operations,
    },
  });
  expect(result).toMatchObject({
    kind: 'signed',
    signature: 'c2lnbmF0dXJl',
    nonce: action.nonce,
    approval: 'voice',
  });
  expect(host.sentences).toEqual(['Log in to the example app']);
  expect(host.verifyInputs[0]?.request).toEqual({
    kind: 'signed_message',
    payload_sha256_hex: '41'.repeat(32),
    summary: 'Log in to the example app',
  });
  expect(host.messages).toEqual([{ action, output: { verdict: 'opaque' } }]);
  expect(host.views.at(-1)).toBe('result::Message signed:Done');
  expect(
    await runSpokenMessage({
      network: 'testnet',
      signal: new AbortController().signal,
      message: {
        ownerAccountId: 'owner.testnet',
        action: { ...action, summary: 'Log in at 9' },
        surfaceMeasurementBinding: { kind: 'disabled' },
        operations: host.operations,
      },
    }),
  ).toEqual({ kind: 'refused', reason: 'summary_not_speakable' });
});
