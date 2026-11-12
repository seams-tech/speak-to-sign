// Unit tests of the pure parts of the spoken multisig page (/multisig/): the contract view
// readers, the amount and receiver rules, and the reading of the verifier's answer. Run with
// `pnpm test` (Node's own test runner, which strips the types).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readMultisigConfig, readProposal, readProposalId, readProposals } from '../src/multisig/contractViews.ts';
import { formatBalance, formatNear, hexOfBase64Url, hundredthsOfYocto, isSpeakableAccount, parseNearAmount, proposalSentence } from '../src/multisig/intent.ts';
import { readVerifyOutput } from '../src/multisig/voiceVerify.ts';

const SIGNER_A = 'a'.repeat(64);
const SIGNER_B = 'b'.repeat(64);
const COMMITMENT = 'fef5fa1f9199c0bc052ac3560dc473ffd7beab386e984439834b41b3eda3d8ee';

test('get_config of 3.0.0 has signers and a threshold; the 2.x config with admins is refused', () => {
  const config = { signers: [SIGNER_A, SIGNER_B], threshold: 2, verifier_public_key: 'ed25519:E8E53ydtc9LRvVz9xBCRrSzyBa5nh1gK1ts53Aoo751U' };
  assert.deepEqual(readMultisigConfig(config), config);
  assert.equal(readMultisigConfig({ admins: [SIGNER_A], verifier_public_key: 'ed25519:x' }), null);
  assert.equal(readMultisigConfig({ ...config, threshold: 3 }), null);
  assert.equal(readMultisigConfig({ ...config, threshold: 0 }), null);
  assert.equal(readMultisigConfig({ ...config, extra: 1 }), null);
});

test('a ProposalView is read with its optional transfer fields', () => {
  const open = { id: 1, commitment_hex: COMMITMENT, proposer: SIGNER_A, approvals: [SIGNER_A], status: 'open', created_at_ms: 1794300000000 };
  assert.deepEqual(readProposal(open), open);
  const executed = { ...open, approvals: [SIGNER_A, SIGNER_B], status: 'executed', receiver: 'seams-faucet.testnet', amount_yocto: '100000000000000000000000' };
  assert.deepEqual(readProposal(executed), executed);
  assert.equal(readProposal({ ...open, commitment_hex: 'FEF5' }), null);
  assert.equal(readProposal({ ...open, status: 'pending' }), null);
  assert.deepEqual(readProposals([executed, open]), [executed, open]);
  assert.equal(readProposals([open, { id: 0 }]), null);
  assert.equal(readProposalId(1), 1);
  assert.equal(readProposalId(0), null);
});

test('amounts follow the grammar: hundredths of a NEAR from 0.01 to 1,000,000', () => {
  assert.deepEqual(parseNearAmount('0.1'), { ok: true, hundredths: 10, yocto: '100000000000000000000000' });
  assert.equal(parseNearAmount('0.001').ok, false);
  assert.equal(parseNearAmount('1000000.01').ok, false);
  assert.equal(hundredthsOfYocto('100000000000000000000000'), 10);
  assert.equal(hundredthsOfYocto('1'), null);
  assert.equal(formatNear(10), '0.1');
  assert.equal(formatBalance('4998088371637832000000000'), '4.99');
  assert.equal(proposalSentence(1, '0.1', 'seams-faucet.testnet'), 'Approve proposal 1: send 0.1 NEAR to seams-faucet.testnet');
});

test('only a named account can be a spoken receiver', () => {
  assert.equal(isSpeakableAccount('seams-faucet.testnet'), true);
  assert.equal(isSpeakableAccount(SIGNER_A), false);
  assert.equal(isSpeakableAccount('0xabc'), false);
  assert.equal(isSpeakableAccount('Bad.testnet'), false);
});

test('base64url bytes become lowercase hex of the given length', () => {
  assert.equal(hexOfBase64Url('AAEC_w', 4), '000102ff');
  assert.equal(hexOfBase64Url('AAEC_w', 32), null);
  assert.equal(hexOfBase64Url('not base64!', 4), null);
});

/** A verifier output with this verdict. */
function output(verdict: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return { kind: 'seams_voice_verify_output_v2', verdict_json: JSON.stringify(verdict), signature_b64: 'c2ln', ...extra };
}

test('an accepted proposal carries its opening; an accepted confirmation carries none', () => {
  const commitment = Buffer.from(COMMITMENT, 'hex').toString('base64url');
  const salt = Buffer.alloc(32, 7).toString('base64url');
  const proposed = readVerifyOutput(output({ outcome: 'accept' }, { multisig: { commitment, salt } }), true);
  assert.equal(proposed.kind, 'accepted');
  assert.deepEqual(proposed.kind === 'accepted' && proposed.opening, { commitmentHex: COMMITMENT, saltHex: '07'.repeat(32) });
  const confirmed = readVerifyOutput(output({ outcome: 'accept' }), false);
  assert.deepEqual(confirmed, { kind: 'accepted', verdict: { verdictJson: JSON.stringify({ outcome: 'accept' }), signatureB64: 'c2ln' }, opening: null });
  // A proposal accept without the opening could never execute.
  assert.equal(readVerifyOutput(output({ outcome: 'accept' }), true).kind, 'unavailable');
});

test('a refusal keeps the signed verdict, and a words refusal shows only what was heard', () => {
  const same = readVerifyOutput(output({ outcome: 'refuse', reason: 'same_speaker' }), false);
  assert.equal(same.kind, 'refused');
  if (same.kind !== 'refused') return;
  assert.equal(same.code, 'same_speaker');
  assert.match(same.reason, /One person cannot approve twice/);
  assert.deepEqual(same.signed, { verdictJson: JSON.stringify({ outcome: 'refuse', reason: 'same_speaker' }), signatureB64: 'c2ln' });

  const words = readVerifyOutput(output({ outcome: 'refuse', reason: 'words', heard: 'approve proposal one send five near' }, { detail: 'margin 0.4' }), false);
  assert.equal(words.kind === 'refused' && words.heard, 'approve proposal one send five near');
  assert.equal(words.kind === 'refused' && words.reason, 'The words did not match the proposal.');

  const speaker = readVerifyOutput(output({ outcome: 'refuse', reason: 'speaker', heard: 'x' }), false);
  assert.equal(speaker.kind === 'refused' && speaker.heard, undefined);
  assert.equal(readVerifyOutput({ kind: 'seams_voice_error_v1', reason: 'unsupported' }, false).kind, 'refused');
});
