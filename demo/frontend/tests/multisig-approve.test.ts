// Unit tests of the approve route (functions/api/multisig/approve.ts): its input checks, its
// settings, and the order of its NEAR steps against a fake chain. No network.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { CallOutcome } from '../src/faucet/nearTx.ts';
import type { Proposal } from '../src/multisig/contractViews.ts';
import {
  handleApprove,
  parseApproveInput,
  readApproveSettings,
  runApproval,
  type Chain,
  type Settings,
  type Signer,
} from '../functions/api/multisig/approve.ts';

const ADMIN_A = 'admin-a.seams-v1.testnet';
const ADMIN_B = 'admin-b.seams-v1.testnet';
const SALT = 'ab'.repeat(32);
const CENT = '10000000000000000000000';
/** 1,000,000 NEAR, the most that the grammar can say. */
const GRAMMAR_MAX = '1000000000000000000000000000000';

const SETTINGS: Settings = {
  contract: 'multisig.seams-v1.testnet',
  notesContract: 'notes.seams-v1.testnet',
  rpcUrl: 'https://rpc.invalid',
  adminA: { account: ADMIN_A, key: 'ed25519:a' },
  adminB: { account: ADMIN_B, key: 'ed25519:b' },
};

const INPUT = { proposal_id: 7, receiver: 'seams-grants.testnet', amount_yocto: CENT, salt_hex: SALT };
const HIDE = { proposal_id: 7, note_id: 42, salt_hex: SALT };

function proposal(approvals: string[], status: Proposal['status'] = 'open'): Proposal {
  return { id: 7, commitment_hex: 'cd'.repeat(32), proposer: 'visitor.testnet', approvals, status, created_at_ms: 1 };
}

interface FakeOptions {
  proposal?: Proposal | null;
  admins?: string[];
  /** The whole `get_config` answer, for a contract of another shape. */
  config?: unknown;
  /** The outcome of a call, by "signer:method". */
  outcomes?: Record<string, Partial<CallOutcome> | Error>;
  /** The answer of `get_note` on the notes contract. Default: practice note 42, not hidden. */
  note?: unknown;
  /** The answer of `get_notes_contract`. Default: the notes contract of SETTINGS. */
  notesContract?: unknown;
}

/** A fake chain: it keeps the approvals and records each call as "signer:method". */
function fakeChain(options: FakeOptions = {}) {
  let current: Proposal | null = options.proposal === undefined ? proposal([]) : options.proposal;
  const calls: string[] = [];
  const args: Record<string, unknown>[] = [];
  const gas: bigint[] = [];
  const chain: Chain = {
    async view(method) {
      if (method === 'get_proposal') return current && { ...current, approvals: [...current.approvals] };
      if (method === 'get_config') {
        return options.config ?? { admins: options.admins ?? [ADMIN_A, ADMIN_B], verifier_public_key: 'ed25519:x' };
      }
      if (method === 'get_notes_contract') return options.notesContract === undefined ? SETTINGS.notesContract : options.notesContract;
      throw new Error(`no view ${method}`);
    },
    async viewNotes(method, viewArgs) {
      if (method !== 'get_note') throw new Error(`no notes view ${method}`);
      if (options.note !== undefined) return options.note;
      return { id: viewArgs.note_id, post_id: 900, author: 'spam.testnet', text: 'Call now', summary: 'Call now', hidden: false };
    },
    async call(signer: Signer, method, callArgs, callGas) {
      const name = `${signer.account}:${method}`;
      calls.push(name);
      args.push(callArgs);
      gas.push(callGas);
      const planned = options.outcomes?.[name];
      if (planned instanceof Error) throw planned;
      const outcome: CallOutcome = { transactionHash: `tx-${calls.length}`, value: method === 'execute' ? true : 1, ...planned };
      if (outcome.failure === undefined && current) {
        if (method === 'approve') current.approvals.push(signer.account);
        if (method === 'execute' && outcome.value === true) {
          current = { ...current, status: 'executed', receiver: INPUT.receiver, amount_yocto: INPUT.amount_yocto };
        }
      }
      return outcome;
    },
  };
  return { chain, calls, args, gas };
}

test('the input is the opening: an id, a named receiver, hundredths of a NEAR and a 32-byte salt', () => {
  assert.deepEqual(parseApproveInput(JSON.stringify(INPUT)), INPUT);
  const bad: unknown[] = [
    'not json',
    [],
    { ...INPUT, extra: 1 },
    { proposal_id: 7, receiver: 'seams-grants.testnet', amount_yocto: CENT },
    { ...INPUT, proposal_id: 0 },
    { ...INPUT, proposal_id: 1.5 },
    { ...INPUT, proposal_id: '7' },
    { ...INPUT, receiver: 'Seams.testnet' },
    { ...INPUT, receiver: 'f'.repeat(64) },
    { ...INPUT, receiver: '0xabc' },
    { ...INPUT, amount_yocto: '0' },
    { ...INPUT, amount_yocto: `0${CENT}` },
    { ...INPUT, amount_yocto: '10000000000000000000001' },
    { ...INPUT, amount_yocto: (BigInt(GRAMMAR_MAX) + BigInt(CENT)).toString() },
    { ...INPUT, amount_yocto: 1e22 },
    { ...INPUT, salt_hex: SALT.toUpperCase() },
    { ...INPUT, salt_hex: SALT.slice(2) },
  ];
  for (const value of bad) {
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    assert.equal(typeof parseApproveInput(text), 'string', text);
  }
});

test('the settings need both admin keys, and have the defaults of the doc', () => {
  assert.match(String(readApproveSettings({})), /MULTISIG_ADMIN_A_KEY and MULTISIG_ADMIN_B_KEY/);
  assert.match(String(readApproveSettings({ MULTISIG_ADMIN_A_KEY: 'ed25519:a' })), /needs MULTISIG_ADMIN_B_KEY\./);
  assert.deepEqual(readApproveSettings({ MULTISIG_ADMIN_A_KEY: 'ed25519:a', MULTISIG_ADMIN_B_KEY: 'ed25519:b' }), {
    contract: 'multisig.seams-v1.testnet',
    notesContract: 'notes.seams-v1.testnet',
    rpcUrl: 'https://test.rpc.fastnear.com',
    adminA: { account: ADMIN_A, key: 'ed25519:a' },
    adminB: { account: ADMIN_B, key: 'ed25519:b' },
  });
  const keys = { MULTISIG_ADMIN_A_KEY: 'ed25519:a', MULTISIG_ADMIN_B_KEY: 'ed25519:b' };
  assert.equal(typeof readApproveSettings({ ...keys, MULTISIG_ADMIN_B: ADMIN_A }), 'string');
  assert.equal(typeof readApproveSettings({ ...keys, MULTISIG_CONTRACT: 'Not An Account' }), 'string');
  assert.equal(typeof readApproveSettings({ ...keys, NOTES_CONTRACT: 'Not An Account' }), 'string');
});

test('a new proposal: admin A approves, admin B approves, admin B executes', async () => {
  const fake = fakeChain();
  const result = await runApproval(fake.chain, SETTINGS, INPUT);
  assert.deepEqual(fake.calls, [`${ADMIN_A}:approve`, `${ADMIN_B}:approve`, `${ADMIN_B}:execute`]);
  assert.deepEqual(fake.args[0], { proposal_id: 7 });
  assert.deepEqual(fake.args[2], INPUT);
  assert.deepEqual(fake.gas, [30_000_000_000_000n, 30_000_000_000_000n, 50_000_000_000_000n]);
  assert.equal(result.kind, 'done');
  if (result.kind !== 'done') return;
  assert.equal(result.executeTransactionHash, 'tx-3');
  assert.equal(result.executed, true);
  assert.equal(result.proposal?.status, 'executed');
  assert.deepEqual(result.proposal?.approvals, [ADMIN_A, ADMIN_B]);
});

test('a second call continues from the first step that is not done', async () => {
  const afterA = fakeChain({ proposal: proposal([ADMIN_A]) });
  await runApproval(afterA.chain, SETTINGS, INPUT);
  assert.deepEqual(afterA.calls, [`${ADMIN_B}:approve`, `${ADMIN_B}:execute`]);

  const afterBoth = fakeChain({ proposal: proposal([ADMIN_A, ADMIN_B]) });
  await runApproval(afterBoth.chain, SETTINGS, INPUT);
  assert.deepEqual(afterBoth.calls, [`${ADMIN_B}:execute`]);
});

test('a failed step stops the run and names the step', async () => {
  const panicA = fakeChain({ outcomes: { [`${ADMIN_A}:approve`]: { failure: 'the proposal is not open' } } });
  assert.deepEqual(await runApproval(panicA.chain, SETTINGS, INPUT), {
    kind: 'failed',
    step: 'admin_a',
    error: 'Admin A could not approve: the proposal is not open',
    transactionHash: 'tx-1',
  });
  assert.deepEqual(panicA.calls, [`${ADMIN_A}:approve`]);

  const downB = fakeChain({ outcomes: { [`${ADMIN_B}:approve`]: new Error('NEAR RPC send_tx: TIMEOUT_ERROR') } });
  const resultB = await runApproval(downB.chain, SETTINGS, INPUT);
  assert.equal(resultB.kind === 'failed' && resultB.step, 'admin_b');
  assert.deepEqual(downB.calls, [`${ADMIN_A}:approve`, `${ADMIN_B}:approve`]);

  const wrongSalt = fakeChain({ outcomes: { [`${ADMIN_B}:execute`]: { failure: 'the opening does not match the commitment' } } });
  const resultExecute = await runApproval(wrongSalt.chain, SETTINGS, INPUT);
  assert.equal(resultExecute.kind === 'failed' && resultExecute.step, 'execute');
  assert.equal(resultExecute.kind === 'failed' && resultExecute.transactionHash, 'tx-3');
});

test('a transfer that does not arrive gives executed: false', async () => {
  const fake = fakeChain({ outcomes: { [`${ADMIN_B}:execute`]: { value: false } } });
  const result = await runApproval(fake.chain, SETTINGS, INPUT);
  assert.equal(result.kind, 'done');
  assert.equal(result.kind === 'done' && result.executed, false);
  assert.equal(result.kind === 'done' && result.proposal?.status, 'open');
});

test('no proposal is 404, an executed one is 409, other admins are 503, and nothing signs', async () => {
  const cases: [FakeOptions, number][] = [
    [{ proposal: null }, 404],
    [{ proposal: proposal([ADMIN_A, ADMIN_B], 'executed') }, 409],
    [{ admins: [ADMIN_A, ADMIN_B, 'admin-c.seams-v1.testnet'] }, 503],
  ];
  for (const [options, status] of cases) {
    const fake = fakeChain(options);
    const result = await runApproval(fake.chain, SETTINGS, INPUT);
    assert.equal(result.kind === 'refused' && result.status, status);
    assert.deepEqual(fake.calls, []);
  }
});

test('the route has no cap: any amount that the grammar can say goes to execute', async () => {
  const input = { ...INPUT, amount_yocto: GRAMMAR_MAX };
  assert.deepEqual(parseApproveInput(JSON.stringify(input)), input);
  const fake = fakeChain();
  assert.equal((await runApproval(fake.chain, SETTINGS, input)).kind, 'done');
  assert.deepEqual(fake.args[2], input);
});

test('a contract of an old shape (with a cap, or with members) stops the run at read, with no throw', async () => {
  const oldShapes = [
    { admins: [ADMIN_A, ADMIN_B], verifier_public_key: 'ed25519:x', max_amount_yocto: '50000000000000000000000' },
    { members: [ADMIN_A, ADMIN_B], threshold: 2, verifier_public_key: 'ed25519:x' },
  ];
  for (const config of oldShapes) {
    const fake = fakeChain({ config });
    assert.deepEqual(await runApproval(fake.chain, SETTINGS, INPUT), {
      kind: 'failed',
      step: 'read',
      error: 'The multisig contract answered in an unexpected form.',
    });
    assert.deepEqual(fake.calls, []);
  }
  const oldProposal = fakeChain({ proposal: { ...proposal([]), confirmations: [], approvals: undefined } as unknown as Proposal });
  assert.equal((await runApproval(oldProposal.chain, SETTINGS, INPUT)).kind, 'failed');
  assert.deepEqual(oldProposal.calls, []);
});

test('the route takes same-origin JSON and answers with the step results', async () => {
  const env = { MULTISIG_ADMIN_A_KEY: 'ed25519:a', MULTISIG_ADMIN_B_KEY: 'ed25519:b' };
  const post = (body: string, origin?: string) =>
    new Request('https://demo.example/api/multisig/approve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}) },
      body,
    });

  const other = await handleApprove(post(JSON.stringify(INPUT), 'https://evil.example'), env, () => fakeChain().chain);
  assert.equal(other.status, 403);
  assert.equal((await handleApprove(post(JSON.stringify(INPUT)), {}, () => fakeChain().chain)).status, 503);
  assert.equal((await handleApprove(post('{}'), env, () => fakeChain().chain)).status, 400);
  assert.equal((await handleApprove(post('x'.repeat(4096)), env, () => fakeChain().chain)).status, 413);

  const done = await handleApprove(post(JSON.stringify(INPUT), 'https://demo.example'), env, () => fakeChain().chain);
  assert.equal(done.status, 200);
  const body = (await done.json()) as { executeTransactionHash: string; executed: boolean; proposal: Proposal };
  assert.equal(body.executeTransactionHash, 'tx-3');
  assert.equal(body.executed, true);
  assert.equal(body.proposal.status, 'executed');

  const failed = await handleApprove(post(JSON.stringify(INPUT)), env, () =>
    fakeChain({ outcomes: { [`${ADMIN_A}:approve`]: { failure: 'stop' } } }).chain,
  );
  assert.equal(failed.status, 502);
  assert.deepEqual(await failed.json(), { error: 'Admin A could not approve: stop', step: 'admin_a', transactionHash: 'tx-1' });
});

test('a hide opening is an id, a note id and a salt', () => {
  assert.deepEqual(parseApproveInput(JSON.stringify(HIDE)), HIDE);
  const bad: unknown[] = [
    { ...HIDE, note_id: 0 },
    { ...HIDE, note_id: '42' },
    { ...HIDE, note_id: 4.2 },
    { ...HIDE, receiver: 'seams-grants.testnet' },
    { ...HIDE, salt_hex: 'xy' },
    { proposal_id: 7, note_id: 42 },
  ];
  for (const value of bad) {
    const text = JSON.stringify(value);
    assert.equal(typeof parseApproveInput(text), 'string', text);
  }
});

test('a hide of a practice note: the admins check it, approve, and execute with the note id', async () => {
  const fake = fakeChain();
  const result = await runApproval(fake.chain, SETTINGS, HIDE);
  assert.deepEqual(fake.calls, [`${ADMIN_A}:approve`, `${ADMIN_B}:approve`, `${ADMIN_B}:execute`]);
  assert.deepEqual(fake.args[2], HIDE);
  assert.equal(result.kind, 'done');
});

test('the admins refuse a real note, a hidden note, a missing note and another notes contract, and nothing signs', async () => {
  const note = { id: 42, post_id: 900, author: 'spam.testnet', text: 'x', summary: 'x', hidden: false };
  const cases: [FakeOptions, number][] = [
    [{ note: { ...note, post_id: 1 } }, 403],
    [{ note: { ...note, hidden: true } }, 409],
    [{ note: null }, 404],
    [{ notesContract: 'other-notes.testnet' }, 503],
    [{ notesContract: null }, 503],
  ];
  for (const [options, status] of cases) {
    const fake = fakeChain(options);
    const result = await runApproval(fake.chain, SETTINGS, HIDE);
    assert.equal(result.kind === 'refused' && result.status, status, JSON.stringify(options));
    assert.deepEqual(fake.calls, []);
  }
  const odd = fakeChain({ note: 'not a note' });
  assert.equal((await runApproval(odd.chain, SETTINGS, HIDE)).kind, 'failed');
  assert.deepEqual(odd.calls, []);
});

test('a transfer reads no note', async () => {
  const fake = fakeChain({ note: { post_id: 1 } });
  assert.equal((await runApproval(fake.chain, SETTINGS, INPUT)).kind, 'done');
});
