// POST /api/multisig/approve  { proposal_id, receiver, amount_yocto, salt_hex }
//                          or  { proposal_id, note_id, salt_hex }
//   ->  { proposal, executeTransactionHash, executed }  or  { error, step? }
//
// The two admin signers of the voice multisig demo (docs/voice-multisig-guests.md). A visitor
// proposes a transfer, or "hide note N" for a reported community note, by voice, and the chain
// holds only its commitment. Then the page sends the opening here. Admin A calls `approve`,
// admin B calls `approve`, and admin B calls `execute` with the opening. The contract checks the
// opening against the commitment and sends the NEAR or hides the note. `executed` is the result
// of the contract's callback: false when the transfer did not arrive or the note was not hidden
// (the proposal is open again).
//
// Before they approve a hide, the admins check the note: it must be a practice note
// (src/multisig/practice.ts) that is not hidden, on the notes contract that the multisig
// moderates. So a visitor cannot hide a real note of the Community Notes page.
//
// Each step is done once. A second call reads the proposal again and continues from the first
// step that is not done. On a failure the answer names the step: `read`, `admin_a`, `admin_b`
// or `execute`. Each admin key is a function-call key for `approve` and `execute` on the
// multisig contract only.
//
// The route sets no cap on the amount. The grammar's own range applies (0.01 to 1,000,000 NEAR),
// and an amount above the balance of the multisig makes `execute` fail.

import { signAndSendCall, viewCall, type CallOutcome } from '../../../src/faucet/nearTx.ts';
import { hasExactKeys, isObject } from '../../../src/guards.ts';
import { readMultisigConfig, readProposal, UNEXPECTED_VIEW, type Proposal } from '../../../src/multisig/contractViews.ts';
import { hundredthsOfYocto, isSpeakableAccount } from '../../../src/multisig/intent.ts';
import { PRACTICE_POST_ID } from '../../../src/multisig/practice.ts';
import { DEFAULT_RPC_URL, isAccountId, json, readBoundedText, refuseOtherOrigin } from '../../lib/http.ts';

interface Env {
  /** "ed25519:..." The function-call key of admin A for the multisig contract. */
  MULTISIG_ADMIN_A_KEY?: string;
  /** "ed25519:..." The function-call key of admin B for the multisig contract. */
  MULTISIG_ADMIN_B_KEY?: string;
  /** Optional. Default admin-a.seams-v1.testnet. */
  MULTISIG_ADMIN_A?: string;
  /** Optional. Default admin-b.seams-v1.testnet. */
  MULTISIG_ADMIN_B?: string;
  /** Optional. Default multisig.seams-v1.testnet. */
  MULTISIG_CONTRACT?: string;
  /** Optional. Default notes.seams-v1.testnet: the notes contract that the multisig moderates. */
  NOTES_CONTRACT?: string;
  /** Optional. Default https://test.rpc.fastnear.com. */
  NEAR_RPC_URL?: string;
}

const DEFAULT_ADMIN_A = 'admin-a.seams-v1.testnet';
const DEFAULT_ADMIN_B = 'admin-b.seams-v1.testnet';
const DEFAULT_CONTRACT = 'multisig.seams-v1.testnet';
const DEFAULT_NOTES_CONTRACT = 'notes.seams-v1.testnet';
const TGAS = 1_000_000_000_000n;
const APPROVE_GAS = 30n * TGAS;
/** `execute`: the commitment check, the transfer and its callback. */
const EXECUTE_GAS = 50n * TGAS;
const MAX_BODY_BYTES = 2048;
const TRANSFER_KEYS = ['proposal_id', 'receiver', 'amount_yocto', 'salt_hex'];
const HIDE_KEYS = ['proposal_id', 'note_id', 'salt_hex'];
const HEX_32 = /^[0-9a-f]{64}$/;

/** The opening of a transfer, or of a hide (`note_id`). It goes to `execute` as it is. */
export type ApproveInput =
  | { proposal_id: number; receiver: string; amount_yocto: string; salt_hex: string }
  | { proposal_id: number; note_id: number; salt_hex: string };

export interface Signer {
  account: string;
  key: string;
}

export interface Settings {
  contract: string;
  /** The notes contract of the hides. */
  notesContract: string;
  rpcUrl: string;
  adminA: Signer;
  adminB: Signer;
}

/** The chain as the steps see it: NEAR RPC in the route, a fake in the tests. */
export interface Chain {
  /** A view of the multisig contract. */
  view(method: string, args: Record<string, unknown>): Promise<unknown>;
  /** A view of the notes contract. */
  viewNotes(method: string, args: Record<string, unknown>): Promise<unknown>;
  call(signer: Signer, method: string, args: Record<string, unknown>, gas: bigint): Promise<CallOutcome>;
}

export type Step = 'read' | 'admin_a' | 'admin_b' | 'execute';

export type ApproveResult =
  | { kind: 'refused'; status: 403 | 404 | 409 | 503; error: string }
  | { kind: 'failed'; step: Step; error: string; transactionHash?: string }
  /** `proposal` is null when the read after `execute` failed. */
  | { kind: 'done'; proposal: Proposal | null; executeTransactionHash: string; executed: boolean };

export const onRequestPost: PagesFunction<Env> = ({ request, env }) => handleApprove(request, env);

export const onRequestGet: PagesFunction<Env> = async () =>
  json({ error: 'Use POST with { "proposal_id", "receiver", "amount_yocto", "salt_hex" } or { "proposal_id", "note_id", "salt_hex" }.' }, 405, {
    Allow: 'POST',
  });

/** The route without the Pages context. `makeChain` is NEAR RPC, or a fake in the tests. */
export async function handleApprove(request: Request, env: Env, makeChain: (settings: Settings) => Chain = nearChain): Promise<Response> {
  const refused = refuseOtherOrigin(request);
  if (refused) return refused;
  const settings = readApproveSettings(env);
  if (typeof settings === 'string') return json({ error: settings }, 503);
  const text = await readBoundedText(request, MAX_BODY_BYTES);
  if (text === null) return json({ error: 'The request is too long.' }, 413);
  const input = parseApproveInput(text);
  if (typeof input === 'string') return json({ error: input }, 400);

  const result = await runApproval(makeChain(settings), settings, input);
  switch (result.kind) {
    case 'refused':
      return json({ error: result.error }, result.status);
    case 'failed':
      return json({ error: result.error, step: result.step, transactionHash: result.transactionHash }, 502);
    case 'done':
      return json({ proposal: result.proposal, executeTransactionHash: result.executeTransactionHash, executed: result.executed });
  }
}

/** The admin signers and the contract, or the reason that the route cannot run. */
export function readApproveSettings(env: Env): Settings | string {
  const keyA = env.MULTISIG_ADMIN_A_KEY?.trim() ?? '';
  const keyB = env.MULTISIG_ADMIN_B_KEY?.trim() ?? '';
  const missing = [keyA ? null : 'MULTISIG_ADMIN_A_KEY', keyB ? null : 'MULTISIG_ADMIN_B_KEY'].filter((name) => name !== null);
  if (missing.length > 0) return `The multisig admins are not set up on this server. It needs ${missing.join(' and ')}.`;
  const adminA = env.MULTISIG_ADMIN_A?.trim() || DEFAULT_ADMIN_A;
  const adminB = env.MULTISIG_ADMIN_B?.trim() || DEFAULT_ADMIN_B;
  const contract = env.MULTISIG_CONTRACT?.trim() || DEFAULT_CONTRACT;
  const notesContract = env.NOTES_CONTRACT?.trim() || DEFAULT_NOTES_CONTRACT;
  for (const [name, value] of [
    ['MULTISIG_ADMIN_A', adminA],
    ['MULTISIG_ADMIN_B', adminB],
    ['MULTISIG_CONTRACT', contract],
    ['NOTES_CONTRACT', notesContract],
  ]) {
    if (!isAccountId(value)) return `${name} is not a NEAR account ID.`;
  }
  if (adminA === adminB) return 'MULTISIG_ADMIN_A and MULTISIG_ADMIN_B must be two accounts.';
  return {
    contract,
    notesContract,
    rpcUrl: env.NEAR_RPC_URL?.trim() || DEFAULT_RPC_URL,
    adminA: { account: adminA, key: keyA },
    adminB: { account: adminB, key: keyB },
  };
}

/**
 * The opening of `{ proposal_id, receiver, amount_yocto, salt_hex }` or of
 * `{ proposal_id, note_id, salt_hex }`, or the reason for a 400.
 */
export function parseApproveInput(text: string): ApproveInput | string {
  const form = 'Send JSON in the form { "proposal_id", "receiver", "amount_yocto", "salt_hex" } or { "proposal_id", "note_id", "salt_hex" }.';
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return form;
  }
  if (!isObject(body)) return form;
  const hide = hasExactKeys(body, HIDE_KEYS);
  if (!hide && !hasExactKeys(body, TRANSFER_KEYS)) return form;
  const { proposal_id, receiver, amount_yocto, salt_hex, note_id } = body;
  if (!isWholeFrom1(proposal_id)) return 'proposal_id must be a whole number from 1.';
  if (hide) {
    if (!isWholeFrom1(note_id)) return 'note_id must be a whole number from 1.';
    if (typeof salt_hex !== 'string' || !HEX_32.test(salt_hex)) return 'salt_hex must be 64 lowercase hex characters.';
    return { proposal_id, note_id, salt_hex };
  }
  if (typeof receiver !== 'string' || !isAccountId(receiver) || !isSpeakableAccount(receiver)) {
    return 'receiver must be a named NEAR account, for example seams-grants.testnet.';
  }
  if (typeof amount_yocto !== 'string' || hundredthsOfYocto(amount_yocto) === null) {
    return 'amount_yocto must be yoctoNEAR in a decimal string: a whole number of 0.01 NEAR.';
  }
  if (typeof salt_hex !== 'string' || !HEX_32.test(salt_hex)) return 'salt_hex must be 64 lowercase hex characters.';
  return { proposal_id, receiver, amount_yocto, salt_hex };
}

function isWholeFrom1(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;
}

/**
 * The admins' check of a hide, before they approve: the multisig moderates the notes contract
 * of this server, and the note is a practice note that is not hidden. Null when it passes.
 */
async function checkHide(chain: Chain, settings: Settings, noteId: number): Promise<ApproveResult | null> {
  let notesContract: unknown;
  let note: unknown;
  try {
    [notesContract, note] = await Promise.all([chain.view('get_notes_contract', {}), chain.viewNotes('get_note', { note_id: noteId })]);
  } catch (cause) {
    return { kind: 'failed', step: 'read', error: `Cannot read the note: ${messageOf(cause)}` };
  }
  if (notesContract !== settings.notesContract) {
    return { kind: 'refused', status: 503, error: 'The multisig does not moderate the notes contract of this server.' };
  }
  if (note === null) return { kind: 'refused', status: 404, error: `The notes contract has no note ${noteId}.` };
  if (!isObject(note) || typeof note.post_id !== 'number') return { kind: 'failed', step: 'read', error: 'The notes contract answered in an unexpected form.' };
  if (note.post_id !== PRACTICE_POST_ID) {
    return { kind: 'refused', status: 403, error: `The admins hide only the practice notes of this demo. Note ${noteId} is a real note.` };
  }
  if (note.hidden === true) return { kind: 'refused', status: 409, error: `Note ${noteId} is hidden already.` };
  return null;
}

/** The steps: read, admin A approves, admin B approves, admin B executes. A done step is skipped. */
export async function runApproval(chain: Chain, settings: Settings, input: ApproveInput): Promise<ApproveResult> {
  const { proposal_id } = input;
  let proposalValue: unknown;
  let configValue: unknown;
  try {
    [proposalValue, configValue] = await Promise.all([chain.view('get_proposal', { proposal_id }), chain.view('get_config', {})]);
  } catch (cause) {
    return { kind: 'failed', step: 'read', error: `Cannot read the multisig: ${messageOf(cause)}` };
  }
  if (proposalValue === null) return { kind: 'refused', status: 404, error: `The multisig has no proposal ${proposal_id}.` };
  const proposal = readProposal(proposalValue);
  const config = readMultisigConfig(configValue);
  if (!proposal || !config) return { kind: 'failed', step: 'read', error: UNEXPECTED_VIEW };
  if (proposal.status === 'executed') {
    return { kind: 'refused', status: 409, error: `Proposal ${proposal_id} is executed already.` };
  }
  const admins = [settings.adminA.account, settings.adminB.account];
  if (config.admins.length !== admins.length || !admins.every((admin) => config.admins.includes(admin))) {
    return { kind: 'refused', status: 503, error: 'The admins of the contract are not the admin signers of this server.' };
  }
  if ('note_id' in input) {
    const refused = await checkHide(chain, settings, input.note_id);
    if (refused) return refused;
  }

  const approvals: [Step, Signer, string][] = [
    ['admin_a', settings.adminA, 'Admin A'],
    ['admin_b', settings.adminB, 'Admin B'],
  ];
  for (const [step, admin, name] of approvals) {
    if (proposal.approvals.includes(admin.account)) continue;
    const approved = await send(step, `${name} could not approve`, () => chain.call(admin, 'approve', { proposal_id }, APPROVE_GAS));
    if (approved.kind === 'failed') return approved;
  }
  const sent = await send('execute', 'Admin B could not execute the proposal', () =>
    chain.call(settings.adminB, 'execute', { ...input }, EXECUTE_GAS),
  );
  if (sent.kind === 'failed') return sent;

  let after: Proposal | null = null;
  try {
    after = readProposal(await chain.view('get_proposal', { proposal_id }));
  } catch {
    // The proposal ran; the page reads the proposal itself.
  }
  return { kind: 'done', proposal: after, executeTransactionHash: sent.outcome.transactionHash, executed: sent.outcome.value === true };
}

async function send(
  step: Step,
  what: string,
  call: () => Promise<CallOutcome>,
): Promise<{ kind: 'sent'; outcome: CallOutcome } | Extract<ApproveResult, { kind: 'failed' }>> {
  try {
    const outcome = await call();
    if (outcome.failure !== undefined) {
      return { kind: 'failed', step, error: `${what}: ${outcome.failure}`, transactionHash: outcome.transactionHash };
    }
    return { kind: 'sent', outcome };
  } catch (cause) {
    return { kind: 'failed', step, error: `${what}: ${messageOf(cause)}` };
  }
}

function nearChain({ rpcUrl, contract, notesContract }: Settings): Chain {
  return {
    view: (method, args) => viewCall<unknown>(rpcUrl, contract, method, args, 'optimistic'),
    viewNotes: (method, args) => viewCall<unknown>(rpcUrl, notesContract, method, args, 'optimistic'),
    call: (signer, method, args, gas) =>
      signAndSendCall(rpcUrl, signer.account, contract, signer.key, { methodName: method, args, gas, deposit: 0n }),
  };
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
