// Unit tests of the pure parts of the multisig screen: the WAV, the resampling, the amount
// rules and the reading of the approve route's answer. Run with `pnpm test` (Node's own test
// runner, which strips the types).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readApproveAnswer } from '../src/multisig/approveClient.ts';
import { readMultisigConfig, readProposal, readProposalId, readProposals } from '../src/multisig/contractViews.ts';
import { formatNear, hexOfBase64Url, hundredthsOfYocto, isSpeakableAccount, parseNearAmount, proposalSentence } from '../src/multisig/intent.ts';
import { base64, encodeWav, MAX_SAMPLES, resampleTo16k, toPcm16, wavFromSamples } from '../src/multisig/wav.ts';

const ascii = (bytes: Uint8Array, start: number, end: number) => String.fromCharCode(...bytes.subarray(start, end));

test('the WAV header is 16 kHz mono PCM16', () => {
  const wav = encodeWav(new Int16Array([0, 1, -1, 32767, -32768]));
  const view = new DataView(wav.buffer);
  assert.equal(wav.length, 44 + 10);
  assert.equal(ascii(wav, 0, 4), 'RIFF');
  assert.equal(view.getUint32(4, true), 36 + 10);
  assert.equal(ascii(wav, 8, 16), 'WAVEfmt ');
  assert.equal(view.getUint32(16, true), 16);
  assert.equal(view.getUint16(20, true), 1);
  assert.equal(view.getUint16(22, true), 1);
  assert.equal(view.getUint32(24, true), 16_000);
  assert.equal(view.getUint32(28, true), 32_000);
  assert.equal(view.getUint16(32, true), 2);
  assert.equal(view.getUint16(34, true), 16);
  assert.equal(ascii(wav, 36, 40), 'data');
  assert.equal(view.getUint32(40, true), 10);
  assert.deepEqual([0, 1, 2, 3, 4].map((index) => view.getInt16(44 + index * 2, true)), [0, 1, -1, 32767, -32768]);
});

test('PCM16 clips values outside -1 to 1', () => {
  assert.deepEqual([...toPcm16(new Float32Array([-2, -1, 0, 0.5, 1, 2]))], [-32768, -32768, 0, 16384, 32767, 32767]);
});

test('48 kHz becomes 16 kHz: the mean of each three samples', () => {
  const output = resampleTo16k(new Float32Array([0, 0.3, 0.6, 1, 1, 1, -1, -1, -1]), 48_000);
  assert.equal(output.length, 3);
  assert.ok(Math.abs((output[0] ?? 0) - 0.3) < 1e-6);
  assert.equal(output[1], 1);
  assert.equal(output[2], -1);
});

test('44.1 kHz keeps the length in time, and a constant stays constant', () => {
  const output = resampleTo16k(new Float32Array(44_100).fill(0.25), 44_100);
  assert.equal(output.length, 16_000);
  assert.ok(output.every((value) => Math.abs(value - 0.25) < 1e-6));
});

test('8 kHz becomes 16 kHz by interpolation', () => {
  assert.deepEqual([...resampleTo16k(new Float32Array([0, 1, 0]), 8_000)], [0, 0.5, 1, 0.5, 0, 0]);
});

test('16 kHz is a copy', () => {
  const input = new Float32Array([0.1, 0.2]);
  const output = resampleTo16k(input, 16_000);
  assert.deepEqual([...output], [...input]);
  assert.notEqual(output, input);
});

test('a long recording is cut to 8 s', () => {
  const wav = wavFromSamples(new Float32Array(48_000 * 9), 48_000);
  assert.equal(wav.length, 44 + MAX_SAMPLES * 2);
});

test('base64 is standard base64', () => {
  assert.equal(base64(new Uint8Array([0, 1, 2, 250, 251, 252])), 'AAEC+vv8');
  assert.equal(base64(new Uint8Array(100_000)).length, Math.ceil(100_000 / 3) * 4);
});

test('amounts are whole hundredths from 0.01 to 1,000,000 NEAR', () => {
  assert.deepEqual(parseNearAmount('25'), { ok: true, hundredths: 2500, yocto: '25000000000000000000000000' });
  assert.deepEqual(parseNearAmount('0.01'), { ok: true, hundredths: 1, yocto: '10000000000000000000000' });
  assert.equal(parseNearAmount('1,000,000').ok, true);
  for (const bad of ['0', '0.001', '1000000.01', '-1', '1e3', '', '2.', '.5']) assert.equal(parseNearAmount(bad).ok, false, bad);
  assert.equal(hundredthsOfYocto('25000000000000000000000000'), 2500);
  assert.equal(hundredthsOfYocto('1'), null);
  assert.equal(hundredthsOfYocto('025'), null);
});

test('amounts and sentences display as the grammar renders them', () => {
  assert.equal(formatNear(2500), '25');
  assert.equal(formatNear(125_000), '1,250');
  assert.equal(formatNear(250), '2.5');
  assert.equal(formatNear(5), '0.05');
  assert.equal(formatNear(125), '1.25');
  assert.equal(proposalSentence(7, formatNear(2500), 'grants.testnet'), 'Approve proposal 7: send 25 NEAR to grants.testnet');
});

test('only named accounts can be said', () => {
  assert.equal(isSpeakableAccount('grants.testnet'), true);
  assert.equal(isSpeakableAccount('bob-1_x.testnet'), true);
  for (const bad of ['a', 'Grants.testnet', 'a..b', 'a-.b', '0xabc', 'a'.repeat(64).replace(/a/g, 'f'), 'a--b.testnet']) {
    assert.equal(isSpeakableAccount(bad), false, bad);
  }
});

test('the commitment and the salt come as base64url and go to the contract as hex', () => {
  const bytes = Uint8Array.from({ length: 32 }, (_, index) => index * 8 + 3);
  const url = base64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  assert.equal(hexOfBase64Url(url, 32), [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join(''));
  assert.equal(hexOfBase64Url(url, 31), null);
  assert.equal(hexOfBase64Url(`${url}=`, 32), null);
  assert.equal(hexOfBase64Url('+/', 1), null);
});

test('the approve answer: a receipt, an earlier execute, or the error of a step', () => {
  const proposal = {
    id: 7,
    commitment_hex: 'cd'.repeat(32),
    proposer: 'visitor.testnet',
    approvals: ['admin-a.seams-v1.testnet', 'admin-b.seams-v1.testnet'],
    status: 'executed',
    created_at_ms: 1,
    receiver: 'seams-grants.testnet',
    amount_yocto: '10000000000000000000000',
  };
  assert.deepEqual(readApproveAnswer(200, { proposal, executeTransactionHash: 'H', executed: true }), {
    kind: 'done',
    proposal,
    transactionHash: 'H',
    executed: true,
  });
  assert.deepEqual(readApproveAnswer(200, { proposal: null, executeTransactionHash: 'H', executed: false }), {
    kind: 'done',
    proposal: null,
    transactionHash: 'H',
    executed: false,
  });
  assert.equal(readApproveAnswer(409, { error: 'Proposal 7 is executed already.' }).kind, 'executed_before');
  assert.deepEqual(readApproveAnswer(502, { error: 'Admin B could not approve: x', step: 'admin_b' }), {
    kind: 'failed',
    message: 'Admin B could not approve: x',
  });
  assert.deepEqual(readApproveAnswer(500, null), { kind: 'failed', message: 'The approve route answered 500.' });
  assert.equal(readApproveAnswer(200, { executed: true }).kind, 'failed');
  // A proposal of another shape is dropped; the page reads the proposal itself.
  assert.equal(readApproveAnswer(200, { proposal: { id: 7 }, executeTransactionHash: 'H', executed: true }).kind, 'done');
});

test('the views are read with checks: the old contract shape gives null, not a throw', () => {
  const config = { admins: ['admin-a.seams-v1.testnet', 'admin-b.seams-v1.testnet'], verifier_public_key: 'ed25519:E8E5', max_amount_yocto: '50000000000000000000000' };
  assert.deepEqual(readMultisigConfig(config), config);
  const old = { members: ['alice.testnet', 'bob.testnet', 'carol.testnet'], threshold: 2, verifier_public_key: 'ed25519:E8E5' };
  assert.doesNotThrow(() => readMultisigConfig(old));
  assert.equal(readMultisigConfig(old), null);
  for (const bad of [null, [], 'x', { ...config, admins: [] }, { ...config, admins: [1] }, { ...config, max_amount_yocto: 5 }, { ...config, max_amount_yocto: '05' }]) {
    assert.equal(readMultisigConfig(bad), null, JSON.stringify(bad));
  }

  const proposal = {
    id: 1,
    commitment_hex: 'ab'.repeat(32),
    proposer: 'visitor.testnet',
    approvals: ['admin-a.seams-v1.testnet'],
    status: 'open',
    created_at_ms: 1794300000000,
  };
  assert.deepEqual(readProposal(proposal), proposal);
  const executed = { ...proposal, status: 'executed', receiver: 'seams-grants.testnet', amount_yocto: '10000000000000000000000' };
  assert.deepEqual(readProposal(executed), executed);
  const oldProposal = { id: 1, commitment_hex: 'ab'.repeat(32), proposer: 'alice.testnet', confirmations: ['alice.testnet'], status: 'open' };
  assert.equal(readProposal(oldProposal), null);
  for (const bad of [{ ...proposal, status: 'done' }, { ...proposal, id: 0 }, { ...proposal, commitment_hex: 'AB'.repeat(32) }, { ...proposal, amount_yocto: 1 }]) {
    assert.equal(readProposal(bad), null, JSON.stringify(bad));
  }
  assert.deepEqual(readProposals([proposal]), [proposal]);
  assert.equal(readProposals([proposal, oldProposal]), null);
  assert.equal(readProposals({}), null);
  assert.equal(readProposalId(1), 1);
  assert.equal(readProposalId('1'), null);
  assert.equal(readProposalId(0), null);
});
