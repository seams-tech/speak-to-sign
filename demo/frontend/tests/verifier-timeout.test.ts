// Unit tests of the OutLayer timeout as the page reads it (src/verifierTimeout.ts and the
// failure of the page's verify route in src/voiceRoute.ts). No network.

import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import {
  isVerifierTimeout,
  OUTLAYER_BUSY_MS,
  OUTLAYER_EXECUTIONS_URL,
  OUTLAYER_TIMEOUT_TEXT,
  outlayerWait,
  VERIFIER_TIMEOUT,
  watchEnrollmentCard,
  watchRequestProgress,
} from '../src/verifierTimeout.ts';
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

/** One wait with mocked timers: the events `busy` and `clear`, in order. */
function timedWait() {
  const events: string[] = [];
  const wait = outlayerWait(
    () => events.push('busy'),
    () => events.push('clear'),
  );
  return { wait, events };
}

test('a verifier that takes more than 10 s is busy, and its answer clears that', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    assert.equal(OUTLAYER_BUSY_MS, 10_000);
    const { wait, events } = timedWait();
    wait.start();
    mock.timers.tick(9_999);
    assert.deepEqual(events, []);
    mock.timers.tick(1);
    assert.deepEqual(events, ['busy']);
    // A second start in the same wait shows nothing again.
    wait.start();
    mock.timers.tick(20_000);
    assert.deepEqual(events, ['busy']);
    wait.stop();
    assert.deepEqual(events, ['busy', 'clear']);
  } finally {
    mock.timers.reset();
  }
});

test('a verifier that answers within 10 s shows nothing', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const { wait, events } = timedWait();
    wait.start();
    mock.timers.tick(9_000);
    wait.stop();
    mock.timers.tick(60_000);
    assert.deepEqual(events, []);
    // The next recording of the same request starts a new wait.
    wait.start();
    mock.timers.tick(10_000);
    assert.deepEqual(events, ['busy']);
  } finally {
    mock.timers.reset();
  }
});

test('the wait of a spoken request runs from the sent recording to the verdict', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const { wait, events } = timedWait();
    watchRequestProgress(wait, 'recording_sent');
    mock.timers.tick(4_000);
    // The second stage of the same wait does not start the 10 s again.
    watchRequestProgress(wait, 'verifier_running');
    mock.timers.tick(6_000);
    assert.deepEqual(events, ['busy']);
    watchRequestProgress(wait, 'verdict');
    assert.deepEqual(events, ['busy', 'clear']);
    // The transaction is not the verifier: a slow one is not a busy OutLayer.
    watchRequestProgress(wait, 'transaction_sent');
    mock.timers.tick(60_000);
    assert.deepEqual(events, ['busy', 'clear']);
  } finally {
    mock.timers.reset();
  }
});

test('the wait of an enrollment card runs only in the check after the signed message', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const { wait, events } = timedWait();
    // The recordings, their short checks and the signed message are not the verifier.
    for (const progress of [
      { stage: 'recording', done: 0 },
      { stage: 'checking', done: 0 },
      { stage: 'checking', done: 1 },
    ]) {
      watchEnrollmentCard(wait, progress);
      mock.timers.tick(30_000);
    }
    assert.deepEqual(events, []);
    watchEnrollmentCard(wait, { stage: 'checking', done: 2 });
    mock.timers.tick(10_000);
    assert.deepEqual(events, ['busy']);
    watchEnrollmentCard(wait, { stage: 'result', done: 0 });
    assert.deepEqual(events, ['busy', 'clear']);
  } finally {
    mock.timers.reset();
  }
});
