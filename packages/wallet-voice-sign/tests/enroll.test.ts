// The enrollment flow of the host plugin, against a fake Wallet core (tests/fakeHost.ts). Core
// holds the phrases and the audio, signs the authorization and sends the sealed recordings:
// seams-wallet tests that side.

import { expect, test } from '@playwright/test';
import { runEnrollment } from '../src/host/enroll';
import { readEnrollmentOutput } from '../src/host/verifier';
import { clip, fakeHost, routeFailure, verifierOutput, type FakeHostOptions } from './fakeHost';

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
function enrollmentHost(options: FakeHostOptions = {}) {
  return fakeHost({ reply: verifierOutput(ACCEPTED_OUTPUT), ...options });
}

test('an enrollment records the three phrases of core, then enrolls exactly their handles', async () => {
  const host = enrollmentHost();
  const result = await runEnrollment(host.enrollmentInput());
  expect(result).toEqual({ kind: 'enrolled', templateEpoch: 1, agreementMilli: 812 });
  expect(host.events).toEqual([
    'record 0',
    'record 1',
    'record 2',
    // No gap: the card waits while core prepares the message and steps aside for the confirm.
    'show: Preparing your signed enrollment',
    'enroll',
    'authorized',
    'show: Storing your voice template',
    'show: Voice enrolled',
  ]);
  expect(host.enrolled).toHaveLength(1);
  expect(host.enrolled[0]).toHaveLength(3);
  expect(new Set(host.enrolled[0]).size).toBe(3);
});

test('the samples of a VoiceID enrollment in the same flow are enrolled without a recording', async () => {
  const host = enrollmentHost();
  const adopted = [clip(), clip(), clip()];
  const result = await runEnrollment(host.enrollmentInput(adopted));
  expect(result).toEqual({ kind: 'enrolled', templateEpoch: 1, agreementMilli: 812 });
  expect(host.events).toEqual([
    'show: Preparing your signed enrollment',
    'enroll',
    'authorized',
    'show: Storing your voice template',
    'show: Voice enrolled',
  ]);
  expect(host.enrolled).toEqual([adopted]);
});

test('a verifier service that did not answer is not a refusal of the recordings', async () => {
  const host = enrollmentHost({
    reply: verifierOutput({ ...REFUSED_OUTPUT, reason: 'speaker_unavailable', detail: null }),
  });
  await runEnrollment(host.enrollmentInput());
  expect(host.events.at(-1)).toBe('show: The check is not available');
});

test('a verifier refusal shows on the card', async () => {
  const host = enrollmentHost({ reply: verifierOutput({ ...REFUSED_OUTPUT, detail: null }) });
  await runEnrollment(host.enrollmentInput());
  expect(host.events.at(-1)).toBe('show: The verifier refused the recordings');
});

test('an unsigned message ends the enrollment with no later view', async () => {
  // The owner closed the confirm.
  const host = enrollmentHost({
    enrollment: { kind: 'not_signed', error: 'The owner closed the confirm.' },
  });
  expect(await runEnrollment(host.enrollmentInput())).toEqual({
    kind: 'unavailable',
    reason: 'not_submitted',
    detail: 'The owner closed the confirm.',
  });
  expect(host.events.slice(-2)).toEqual(['show: Preparing your signed enrollment', 'enroll']);
});

test('a cancel on a phrase records no other phrase and enrolls nothing', async () => {
  const host = enrollmentHost({ clips: [clip(), { kind: 'cancelled' }] });
  expect(await runEnrollment(host.enrollmentInput())).toEqual({ kind: 'cancelled' });
  expect(host.events).toEqual(['record 0', 'record 1']);
  expect(host.enrolled).toEqual([]);
});

test('a recording that VoiceID cannot make is unavailable', async () => {
  const host = enrollmentHost({ clips: [{ kind: 'unavailable', detail: 'no microphone' }] });
  expect(await runEnrollment(host.enrollmentInput())).toEqual({
    kind: 'unavailable',
    reason: 'voiceid_unavailable',
    detail: 'no microphone',
  });
  expect(host.enrolled).toEqual([]);
});

test('a failure of the verify route enrolls nothing', async () => {
  const host = enrollmentHost({ reply: routeFailure('verifier_timeout') });
  expect(await runEnrollment(host.enrollmentInput())).toEqual({
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
