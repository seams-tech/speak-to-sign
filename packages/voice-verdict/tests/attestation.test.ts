// A real attestation of one verifier call on OutLayer testnet (see the fixture's comment).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import {
  checkAttestationBinding,
  fetchAttestation,
  measurementsApproved,
  parseTdxQuote,
  taskHash,
  WORKER_CONTRACT,
  type AttestationRecord,
} from '../src/index.ts';

const fixture = JSON.parse(
  readFileSync(new URL('./fixtures/outlayer_attestation_testnet.json', import.meta.url), 'utf8'),
) as { input: unknown; output: Record<string, unknown>; record: AttestationRecord };
const { record, output, input } = fixture;
/** Verifier 0.5.2, the active version on testnet at the time (the root README, "Testnet facts"). */
const WASM_0_5_2 = '96b79b518613a50538b060da2279c91e12b0619499c532c2708f61ddb790d7e5';
const good = { record, output, acceptedWasmHashes: [WASM_0_5_2] };

test('the quote commits to the record, and the record to the output and the WASM', async () => {
  const result = await checkAttestationBinding({
    ...good,
    input,
    projectId: 'seams-v1.testnet/voice-verifier',
    callerAccountId: 'cyan-loong.testnet',
  });
  assert.ok(result.ok);
  assert.equal(result.wasmHash, WASM_0_5_2);
  assert.deepEqual(result.notChecked, ['quote_signature', 'measurements_approved']);
  // RTMR3 is the `worker_measurement` of the record.
  assert.equal(result.measurements.rtmr3, (record as unknown as { worker_measurement: string }).worker_measurement);
  for (const value of Object.values(result.measurements)) assert.match(value, /^[0-9a-f]{96}$/);
  assert.equal(result.quote.length, 5006);
  // The key order of the output that you hold does not matter.
  const reordered = Object.fromEntries(Object.entries(output).reverse());
  assert.ok((await checkAttestationBinding({ ...good, output: reordered })).ok);
});

test('the task hash is the first 32 bytes of the report data', async () => {
  const parsed = parseTdxQuote(record.tdx_quote);
  assert.ok(parsed);
  assert.equal(Buffer.from(parsed.reportData.subarray(0, 32)).toString('hex'), Buffer.from(await taskHash(record)).toString('hex'));
  assert.ok(parsed.reportData.subarray(32).every((byte) => byte === 0));
});

test('each changed link is refused', async () => {
  const code = async (change: Partial<Parameters<typeof checkAttestationBinding>[0]>) => {
    const result = await checkAttestationBinding({ ...good, ...change });
    return result.ok ? 'ok' : result.refusal.code;
  };
  assert.equal(await code({ output: { ...output, reason: 'words' } }), 'output_mismatch');
  assert.equal(await code({ input: { op: 'verify' } }), 'input_mismatch');
  assert.equal(await code({ acceptedWasmHashes: ['00'.repeat(32)] }), 'wasm_not_accepted');
  assert.equal(await code({ acceptedWasmHashes: [] }), 'wasm_not_accepted');
  assert.equal(await code({ projectId: 'other.testnet/voice-verifier' }), 'project_mismatch');
  assert.equal(await code({ callerAccountId: 'other.testnet' }), 'caller_mismatch');
  // A record that names another WASM, another caller or another time does not match the quote.
  for (const change of [
    { wasm_hash: '00'.repeat(32) },
    { caller_account_id: 'other.testnet' },
    { project_id: 'other.testnet/voice-verifier' },
    { timestamp: record.timestamp + 1 },
    { task_id: record.task_id + 1 },
    { input_hash: '00'.repeat(32) },
  ]) {
    assert.equal(await code({ record: { ...record, ...change } }), 'task_hash_mismatch', JSON.stringify(change));
  }
  // A changed output hash needs a changed output, and then the quote does not match.
  const forged = { ...output, reason: 'words' };
  const hash = '6b1d9c2e'.padEnd(64, '0');
  assert.equal(await code({ record: { ...record, output_hash: hash }, output: forged }), 'task_hash_mismatch');
  assert.equal(await code({ record: { ...record, tdx_quote: 'AAAA' } }), 'malformed');
  assert.equal(await code({ record: { ...record, task_type: 'compile' } }), 'malformed');
  assert.equal(await code({ record: { ...record, timestamp: 1_700_000_000 } }), 'malformed');
});

test('the measurements go to the worker contract as a view call', async () => {
  const parsed = parseTdxQuote(record.tdx_quote);
  assert.ok(parsed);
  let seen: Record<string, unknown> = {};
  const fakeRpc = (async (_url: unknown, init?: RequestInit) => {
    seen = JSON.parse(String(init?.body)).params;
    return Response.json({ result: { result: Array.from(new TextEncoder().encode('true')) } });
  }) as typeof fetch;
  const approved = await measurementsApproved({
    rpcUrl: 'https://rpc.test',
    contract: WORKER_CONTRACT.testnet,
    measurements: parsed.measurements,
    fetch: fakeRpc,
  });
  assert.equal(approved, true);
  assert.equal(seen.account_id, 'worker.outlayer.testnet');
  assert.equal(seen.method_name, 'is_measurements_approved');
  assert.deepEqual(JSON.parse(atob(String(seen.args_base64))), { measurements: parsed.measurements });
  const refused = (async () => Response.json({ result: { result: Array.from(new TextEncoder().encode('false')) } })) as typeof fetch;
  assert.equal(await measurementsApproved({ rpcUrl: 'https://rpc.test', contract: 'c', measurements: parsed.measurements, fetch: refused }), false);
  const failed = (async () => Response.json({ error: { name: 'HANDLER_ERROR' } })) as typeof fetch;
  await assert.rejects(measurementsApproved({ rpcUrl: 'https://rpc.test', contract: 'c', measurements: parsed.measurements, fetch: failed }));
});

test('the attestation URL of a call', async () => {
  const served = (async (url: unknown) => {
    assert.equal(String(url), 'https://testnet-api.outlayer.ai/attestations/by-call/8cb0bb20-8974-4042-af56-147fe550190e');
    return Response.json(record);
  }) as typeof fetch;
  const fetched = await fetchAttestation('https://testnet-api.outlayer.ai/', `/attestations/by-call/${record.call_id}`, { fetch: served });
  assert.equal(fetched.task_id, record.task_id);
  await assert.rejects(fetchAttestation('https://testnet-api.outlayer.ai', 'https://evil.test/x', { fetch: served }), RangeError);
  await assert.rejects(fetchAttestation('https://testnet-api.outlayer.ai', '/attestations/by-call/../x', { fetch: served }), RangeError);
});
