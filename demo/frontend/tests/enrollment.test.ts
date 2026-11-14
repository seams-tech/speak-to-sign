// Unit tests of the voice setup for an account that is not on NEAR testnet
// (src/signer/enrollment.ts). No network.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { enrollRefusalText, NOT_ON_TESTNET, verifierCanFind } from '../src/signer/enrollment.ts';

const onTestnet = { free: 10n ** 23n, usdc: 0n };
const notOnTestnet = { free: null, usdc: 0n };

test('an account that is not on testnet stops the voice setup, if the faucet sent nothing', () => {
  // The faucet refused (the limit of the network), or the account got the faucet before.
  assert.equal(verifierCanFind({ balance: notOnTestnet, faucet: { kind: 'failed', text: 'limit' } }), false);
  assert.equal(verifierCanFind({ balance: notOnTestnet, faucet: { kind: 'claimed' } }), false);
  assert.equal(verifierCanFind({ balance: notOnTestnet, faucet: { kind: 'idle' } }), false);
});

test('an account with NEAR passes, from the faucet or from another sender', () => {
  assert.equal(verifierCanFind({ balance: onTestnet, faucet: { kind: 'failed', text: 'limit' } }), true);
  assert.equal(verifierCanFind({ balance: onTestnet, faucet: { kind: 'idle' } }), true);
  // After a drip, the NEAR lands while the visitor records.
  assert.equal(verifierCanFind({ balance: notOnTestnet, faucet: { kind: 'sent', hash: 'h', near: 1n, usdc: 1n } }), true);
});

test('a balance that was not read does not stop the voice setup', () => {
  assert.equal(verifierCanFind({ balance: null, faucet: { kind: 'idle' } }), true);
});

test('the unknown_key refusal of the verifier says that the account is not on testnet', () => {
  assert.equal(enrollRefusalText('not_authorized', 'authorization: unknown_key'), NOT_ON_TESTNET);
  assert.match(NOT_ON_TESTNET, /not on NEAR testnet/);
});

test('each other refusal keeps its words and its detail', () => {
  assert.equal(
    enrollRefusalText('not_authorized', 'authorization: function_call_key'),
    'The signed message is not from a full-access key of this account. authorization: function_call_key',
  );
  assert.equal(enrollRefusalText('quality', undefined), 'A recording was too short or too quiet.');
  assert.equal(enrollRefusalText('new_reason', undefined), 'The verifier refused (new_reason).');
});
