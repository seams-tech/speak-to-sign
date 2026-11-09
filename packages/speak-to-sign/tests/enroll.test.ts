// The enrollment flow of the host plugin, against a fake Wallet core. The Wallet's enrollment
// digest is tested in seams-wallet against the verifier's vectors.

import { expect, test } from '@playwright/test';
import type {
  SpeakToSignHostEnrollment,
  SpeakToSignHostOperations,
  SpeakToSignPrompt,
} from '@seams/wallet/speak-to-sign-host';
import { ENROLLMENT_PHRASES, runEnrollment } from '../src/host/enroll';
import { readEnrollmentOutput } from '../src/host/verifier';

type Clip = Awaited<ReturnType<SpeakToSignPrompt['record']>>;
type Authorization = Awaited<ReturnType<SpeakToSignHostOperations['authorizeEnrollment']>>;
type VerifyReply = Awaited<ReturnType<SpeakToSignHostOperations['verify']>>;

const AUTHORIZATION = {
  public_key: 'ed25519:9C6hybhQ6Aycep9jaUnP6uL9ZYvDjUp1aSkFWPUFJtpj',
  signature_b64:
    'En0KfB6HYRZT/TDie6POI4AUECLQfqud3vfZQZg1xGLGFxLsis6SdJGynVlytmrunBgodrkpePoD6KuCXnfjBQ==',
  nonce_b64: 'KysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKys=',
};
const ACCEPTED_OUTPUT = {
  kind: 'seams_voice_enrollment_v3',
  verifier: '0.3.0',
  owner: 'owner.testnet',
  outcome: 'accept',
  reason: null,
  agreement_milli: 812,
  audio_digests: [],
  enrollment_digest: 'x',
  template_epoch: 1,
  verifier_public_key: 'ed25519:Bz1',
  ms: { total: 3900 },
  detail: null,
};

/** The flow sends the recorded bytes as they are, so distinct bytes stand for each recording. */
function clip(index: number): Extract<Clip, { kind: 'captured' }> {
  return {
    kind: 'captured',
    wav: Uint8Array.from({ length: 64 }, (_, at) => (at * index) % 256),
    speechMs: 1_000,
    endOfSpeechAt: 0,
  };
}

type FakeEnrollment = {
  input: SpeakToSignHostEnrollment;
  sentences: string[];
  /** What happened on each card and in core, in order. */
  events: string[];
  authorized: Array<readonly Uint8Array[]>;
  verifyInputs: Array<Readonly<Record<string, unknown>>>;
};

function fakeEnrollment(options: {
  clips?: Clip[];
  authorization?: Authorization;
  reply?: VerifyReply;
}): FakeEnrollment {
  const fake: FakeEnrollment = {
    sentences: [],
    events: [],
    authorized: [],
    verifyInputs: [],
    input: undefined as never,
  };
  const operations: SpeakToSignHostOperations = {
    async openPrompt(request) {
      fake.sentences.push(request.sentence);
      const index = fake.sentences.length;
      fake.events.push(`open ${index}`);
      return {
        kind: 'opened',
        prompt: {
          record: async () => {
            fake.events.push(`record ${index}`);
            return options.clips?.[index - 1] ?? clip(index);
          },
          show: async (view) => {
            fake.events.push(
              `show ${index}: ${view.kind === 'check' ? view.caption : view.headline}`,
            );
            return view.kind === 'check' ? 'replaced' : 'action';
          },
          close: () => fake.events.push(`close ${index}`),
        },
      };
    },
    async receiverExists() {
      throw new Error('An enrollment checks no receiver.');
    },
    async verify(verifierInput) {
      fake.events.push('verify');
      fake.verifyInputs.push(verifierInput);
      return options.reply ?? { kind: 'output', output: ACCEPTED_OUTPUT };
    },
    async payWithVerdict() {
      throw new Error('An enrollment sends no transfer.');
    },
    async signNoteWithVerdict() {
      throw new Error('An enrollment signs no note.');
    },
    async authorizeEnrollment(clips) {
      fake.events.push('authorize');
      fake.authorized.push(clips);
      return options.authorization ?? { kind: 'signed', authorization: AUTHORIZATION };
    },
  };
  fake.input = {
    walletId: 'wallet:owner' as never,
    network: 'testnet',
    signal: new AbortController().signal,
    ownerAccountId: 'owner.testnet',
    surfaceMeasurementBinding: { kind: 'disabled' },
    operations,
  };
  return fake;
}

test('an enrollment records three phrases, authorizes exactly them, then enrolls', async () => {
  const fake = fakeEnrollment({});
  const result = await runEnrollment(fake.input);
  expect(result).toEqual({ kind: 'enrolled', templateEpoch: 1, agreementMilli: 812 });
  expect(fake.sentences).toEqual([...ENROLLMENT_PHRASES]);
  const clips = [clip(1), clip(2), clip(3)].map((captured) => captured.wav);
  expect(fake.authorized).toEqual([clips]);
  expect(fake.verifyInputs).toEqual([
    {
      op: 'enroll',
      owner: 'owner.testnet',
      audio_wav_b64: clips.map((wav) => Buffer.from(wav).toString('base64')),
      authorization: AUTHORIZATION,
    },
  ]);
});

test('the card of the third phrase stays open from the recording to the result', async () => {
  const fake = fakeEnrollment({});
  await runEnrollment(fake.input);
  expect(fake.events).toEqual([
    'open 1',
    'record 1',
    'close 1',
    'open 2',
    'record 2',
    'close 2',
    'open 3',
    'record 3',
    // No gap: the card waits while core prepares the message, and the confirm opens over it.
    'show 3: Preparing your signed enrollment',
    'authorize',
    'show 3: Storing your voice template',
    'verify',
    'show 3: Voice enrolled',
    'close 3',
  ]);

  const refused = fakeEnrollment({
    reply: { kind: 'output', output: { ...ACCEPTED_OUTPUT, outcome: 'refuse', reason: 'speaker' } },
  });
  await runEnrollment(refused.input);
  expect(refused.events.slice(-2)).toEqual([
    'show 3: The verifier refused the recordings',
    'close 3',
  ]);

  // The owner closed the confirm: the card closes, and nothing goes to the verifier.
  const unsigned = fakeEnrollment({
    authorization: { kind: 'not_signed', error: 'The owner closed the confirm.' },
  });
  await runEnrollment(unsigned.input);
  expect(unsigned.events.slice(-3)).toEqual([
    'show 3: Preparing your signed enrollment',
    'authorize',
    'close 3',
  ]);

  // A cancel on a phrase closes that card and opens no other.
  const cancelled = fakeEnrollment({ clips: [clip(1), { kind: 'cancelled' }] });
  await runEnrollment(cancelled.input);
  expect(cancelled.events).toEqual(['open 1', 'record 1', 'close 1', 'open 2', 'record 2', 'close 2']);
});

test('a cancel, an unsigned message or a route failure enrolls nothing', async () => {
  const cancelled = fakeEnrollment({ clips: [clip(1), { kind: 'cancelled' }] });
  expect(await runEnrollment(cancelled.input)).toEqual({ kind: 'cancelled' });
  expect(cancelled.sentences).toHaveLength(2);
  expect(cancelled.authorized).toEqual([]);

  const unsigned = fakeEnrollment({
    authorization: { kind: 'not_signed', error: 'The owner closed the confirm.' },
  });
  expect(await runEnrollment(unsigned.input)).toEqual({
    kind: 'unavailable',
    reason: 'not_submitted',
    detail: 'The owner closed the confirm.',
  });
  expect(unsigned.verifyInputs).toEqual([]);

  const failed = fakeEnrollment({ reply: { kind: 'failed', code: 'verifier_timeout' } });
  expect(await runEnrollment(failed.input)).toEqual({
    kind: 'unavailable',
    reason: 'verifier_unavailable',
    detail: 'verifier_timeout',
  });
});

test('a verifier refusal keeps its reason, and an unknown output is unavailable', () => {
  const refused = { ...ACCEPTED_OUTPUT, outcome: 'refuse', reason: 'speaker', detail: 'low' };
  expect(readEnrollmentOutput(refused)).toEqual({
    kind: 'refused',
    reason: 'speaker',
    detail: 'low',
  });
  expect(readEnrollmentOutput({ ...refused, reason: 'not_authorized', detail: null })).toEqual({
    kind: 'refused',
    reason: 'not_authorized',
  });
  for (const bad of [
    null,
    { ...ACCEPTED_OUTPUT, kind: 'seams_voice_enrollment_v2' },
    { ...ACCEPTED_OUTPUT, template_epoch: 0 },
    { ...refused, reason: 'words' },
  ]) {
    expect(readEnrollmentOutput(bad), JSON.stringify(bad)).toEqual({
      kind: 'unavailable',
      reason: 'verifier_unavailable',
      detail: 'invalid output',
    });
  }
});
