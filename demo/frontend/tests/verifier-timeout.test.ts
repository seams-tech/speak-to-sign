// Unit tests of the OutLayer timeout as the page reads it (src/verifierTimeout.ts and the
// failure of the page's verify route in src/voiceRoute.ts). No network.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isVerifierTimeout, OUTLAYER_EXECUTIONS_URL, OUTLAYER_TIMEOUT_TEXT, VERIFIER_TIMEOUT } from '../src/verifierTimeout.ts';
import { routeFailure } from '../src/voiceRoute.ts';

test("the Wallet's timeout result is verifier_unavailable with the detail verifier_timeout", () => {
  assert.equal(isVerifierTimeout({ reason: 'verifier_unavailable', detail: 'verifier_timeout' }), true);
  // Another failure of the route and another reason are not a timeout of OutLayer.
  assert.equal(isVerifierTimeout({ reason: 'verifier_unavailable', detail: 'verifier_unreachable' }), false);
  assert.equal(isVerifierTimeout({ reason: 'verifier_unavailable' }), false);
  assert.equal(isVerifierTimeout({ reason: 'voiceid_unavailable', detail: 'verifier_timeout' }), false);
});

test("the page's route marks a timeout with its code, and the page reads it", () => {
  assert.deepEqual(routeFailure(502, { error: OUTLAYER_TIMEOUT_TEXT, code: VERIFIER_TIMEOUT }), {
    kind: 'unavailable',
    reason: OUTLAYER_TIMEOUT_TEXT,
    timedOut: true,
  });
});

test('another failure of the route is not a timeout', () => {
  assert.deepEqual(routeFailure(502, { error: 'The verifier is not reachable.' }), { kind: 'unavailable', reason: 'The verifier is not reachable.' });
  assert.deepEqual(routeFailure(500, null), { kind: 'unavailable', reason: 'The verify route answered 500.' });
  assert.deepEqual(routeFailure(502, { error: 7, code: 'other' }), { kind: 'unavailable', reason: 'The verify route answered 502.' });
});

test("the link goes to OutLayer's list of executions", () => {
  assert.equal(OUTLAYER_EXECUTIONS_URL, 'https://app.outlayer.ai/executions');
  assert.match(OUTLAYER_TIMEOUT_TEXT, /^OutLayer timed out/);
});
