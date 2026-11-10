// The enrollment flow of the host plugin, against a fake Wallet core (tests/fakeHost.ts). The
// Wallet's enrollment digest is tested in seams-wallet against the verifier's vectors.

import { expect, test } from '@playwright/test';
import type { SpeakToSignHostEnrollment } from '@seams/wallet/speak-to-sign-host';
import { ENROLLMENT_PHRASES, runEnrollment } from '../src/host/enroll';
import { readEnrollmentOutput } from '../src/host/verifier';
import {
  clip,
  fakeHost,
  routeFailure,
  verifierOutput,
  type FakeHost,
  type FakeHostOptions,
} from './fakeHost';

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
const REFUSED_OUTPUT = { ...ACCEPTED_OUTPUT, outcome: 'refuse', reason: 'speaker', detail: 'low' };

/** By default the owner signs the message and the verifier stores the template. */
function enrollmentHost(options: FakeHostOptions = {}): FakeHost {
  return fakeHost({
    authorization: { kind: 'signed', authorization: AUTHORIZATION },
    reply: verifierOutput(ACCEPTED_OUTPUT),
    enrollment: true,
    ...options,
  });
}

function enrollmentInput(
  host: FakeHost,
  recordings: SpeakToSignHostEnrollment['recordings'] = null,
): SpeakToSignHostEnrollment {
  return {
    walletId: 'wallet:owner' as never,
    network: 'testnet',
    signal: new AbortController().signal,
    ownerAccountId: 'owner.testnet',
    surfaceMeasurementBinding: { kind: 'disabled' },
    operations: host.operations,
    recordings,
  };
}

test('an enrollment records three phrases, authorizes exactly them, then enrolls', async () => {
  const host = enrollmentHost();
  const result = await runEnrollment(enrollmentInput(host));
  expect(result).toEqual({ kind: 'enrolled', templateEpoch: 1, agreementMilli: 812 });
  expect(host.sentences).toEqual([...ENROLLMENT_PHRASES]);
  const clips = [clip(1), clip(2), clip(3)].map((captured) => captured.wav);
  expect(host.authorized).toEqual([clips]);
  expect(host.verifyInputs).toEqual([
    {
      op: 'enroll',
      owner: 'owner.testnet',
      audio_wav_b64: clips.map((wav) => Buffer.from(wav).toString('base64')),
      authorization: AUTHORIZATION,
    },
  ]);
});

test('the card of the third phrase stays open from the recording to the result', async () => {
  const host = enrollmentHost();
  await runEnrollment(enrollmentInput(host));
  expect(host.events).toEqual([
    'open 1',
    'record 1',
    'close 1',
    'open 2',
    'record 2',
    'close 2',
    'open 3',
    'record 3',
    // No gap: the card waits while core prepares the message and steps aside for the confirm.
    'show 3: Preparing your signed enrollment',
    'authorize',
    'show 3: Storing your voice template',
    'verify',
    'show 3: Voice enrolled',
    'close 3',
  ]);
});

test('the samples of a VoiceID enrollment in the same flow are enrolled without a recording', async () => {
  const host = enrollmentHost();
  const recordings = [clip(7), clip(8), clip(9)].map((captured, index) => ({
    wav: captured.wav,
    sentence: `VoiceID phrase ${index + 1}.`,
  }));
  const result = await runEnrollment(enrollmentInput(host, recordings));
  expect(result).toEqual({ kind: 'enrolled', templateEpoch: 1, agreementMilli: 812 });
  // One card, on the last sentence that the owner read for VoiceID.
  expect(host.sentences).toEqual(['VoiceID phrase 3.']);
  expect(host.events).toEqual([
    'open 1',
    'show 1: Preparing your signed enrollment',
    'authorize',
    'show 1: Storing your voice template',
    'verify',
    'show 1: Voice enrolled',
    'close 1',
  ]);
  expect(host.authorized).toEqual([recordings.map((recording) => recording.wav)]);
});

test('a verifier service that did not answer is not a refusal of the recordings', async () => {
  const host = enrollmentHost({
    reply: verifierOutput({ ...REFUSED_OUTPUT, reason: 'speaker_unavailable', detail: null }),
  });
  await runEnrollment(enrollmentInput(host));
  expect(host.events.slice(-2)).toEqual(['show 3: The check is not available', 'close 3']);
});

test('a verifier refusal shows on the card of the third phrase, then the card closes', async () => {
  const host = enrollmentHost({ reply: verifierOutput({ ...REFUSED_OUTPUT, detail: null }) });
  await runEnrollment(enrollmentInput(host));
  expect(host.events.slice(-2)).toEqual([
    'show 3: The verifier refused the recordings',
    'close 3',
  ]);
});

test('an unsigned message closes the card, and nothing goes to the verifier', async () => {
  // The owner closed the confirm.
  const host = enrollmentHost({
    authorization: { kind: 'not_signed', error: 'The owner closed the confirm.' },
  });
  expect(await runEnrollment(enrollmentInput(host))).toEqual({
    kind: 'unavailable',
    reason: 'not_submitted',
    detail: 'The owner closed the confirm.',
  });
  expect(host.events.slice(-3)).toEqual([
    'show 3: Preparing your signed enrollment',
    'authorize',
    'close 3',
  ]);
  expect(host.verifyInputs).toEqual([]);
});

test('a cancel on a phrase closes that card, opens no other and enrolls nothing', async () => {
  const host = enrollmentHost({ clips: [clip(1), { kind: 'cancelled' }] });
  expect(await runEnrollment(enrollmentInput(host))).toEqual({ kind: 'cancelled' });
  expect(host.events).toEqual(['open 1', 'record 1', 'close 1', 'open 2', 'record 2', 'close 2']);
  expect(host.sentences).toHaveLength(2);
  expect(host.authorized).toEqual([]);
});

test('a failure of the verify route enrolls nothing', async () => {
  const host = enrollmentHost({ reply: routeFailure('verifier_timeout') });
  expect(await runEnrollment(enrollmentInput(host))).toEqual({
    kind: 'unavailable',
    reason: 'verifier_unavailable',
    detail: 'verifier_timeout',
  });
});

test('a verifier refusal keeps its reason and its detail', () => {
  expect(readEnrollmentOutput(REFUSED_OUTPUT)).toEqual({
    kind: 'refused',
    reason: 'speaker',
    detail: 'low',
  });
});

test('a verifier refusal with no detail has none', () => {
  expect(
    readEnrollmentOutput({ ...REFUSED_OUTPUT, reason: 'not_authorized', detail: null }),
  ).toEqual({ kind: 'refused', reason: 'not_authorized' });
});

const UNKNOWN_OUTPUTS: Array<[string, unknown]> = [
  ['no output', null],
  ['an older output kind', { ...ACCEPTED_OUTPUT, kind: 'seams_voice_enrollment_v2' }],
  ['template epoch 0', { ...ACCEPTED_OUTPUT, template_epoch: 0 }],
  ['a refusal reason of verify', { ...REFUSED_OUTPUT, reason: 'words' }],
];

for (const [name, output] of UNKNOWN_OUTPUTS) {
  test(`the enrollment is unavailable for ${name}`, () => {
    expect(readEnrollmentOutput(output)).toEqual({
      kind: 'unavailable',
      reason: 'verifier_unavailable',
      detail: 'invalid output',
    });
  });
}
