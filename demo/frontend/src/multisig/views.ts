// Reads the voice multisig contract (demo/contracts/voice-multisig) with its views over NEAR
// JSON-RPC: `get_config`, `get_proposals`, `get_proposal` and `next_proposal_id`. Each answer is
// checked (contractViews.ts). A failure is an Error whose message is a full sentence for the page.

import { isDecimalText, isObject } from '../guards';
import {
  readMultisigConfig,
  readProposal,
  readProposalId,
  readProposals,
  UNEXPECTED_VIEW,
  type MultisigConfig,
  type Proposal,
} from './contractViews';

const RPC_ERRORS: Record<string, string> = {
  UNKNOWN_ACCOUNT: 'The multisig contract account does not exist yet.',
  NO_CONTRACT_CODE: 'The multisig contract account has no contract code yet.',
  CONTRACT_EXECUTION_ERROR: 'A view of the multisig contract failed.',
};

/** The error message of a missing contract: the screen shows example data for it. */
export function isMissingContract(message: string): boolean {
  return message === RPC_ERRORS.UNKNOWN_ACCOUNT || message === RPC_ERRORS.NO_CONTRACT_CODE;
}

async function rpcQuery(rpcUrl: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 'multisig-demo', method: 'query', params: { finality: 'optimistic', ...params } }),
  });
  if (!response.ok) throw new Error(`NEAR RPC answered ${response.status}. Try again in a moment.`);
  const body: unknown = await response.json().catch(() => null);
  if (!isObject(body)) throw new Error('NEAR RPC gave an answer that the page cannot read.');
  if (isObject(body.error)) {
    const cause = isObject(body.error.cause) && typeof body.error.cause.name === 'string' ? body.error.cause.name : null;
    const message = typeof body.error.message === 'string' ? body.error.message : 'unknown';
    throw new Error((cause && RPC_ERRORS[cause]) ?? `NEAR RPC refused the call (${cause ?? message}).`);
  }
  if (!isObject(body.result)) throw new Error('NEAR RPC gave no result.');
  return body.result;
}

/** A view's JSON answer, not checked yet. */
async function view(rpcUrl: string, contract: string, method: string, args: Record<string, unknown>): Promise<unknown> {
  const result = await rpcQuery(rpcUrl, {
    request_type: 'call_function',
    account_id: contract,
    method_name: method,
    args_base64: btoa(JSON.stringify(args)),
  });
  if (typeof result.error === 'string') throw new Error(RPC_ERRORS.CONTRACT_EXECUTION_ERROR);
  const bytes = result.result;
  if (!Array.isArray(bytes) || !bytes.every((byte) => typeof byte === 'number')) throw new Error(UNEXPECTED_VIEW);
  try {
    return JSON.parse(new TextDecoder().decode(new Uint8Array(bytes))) as unknown;
  } catch {
    throw new Error(UNEXPECTED_VIEW);
  }
}

/** The reader's value, or the error that the page shows for another shape. */
function checked<T>(value: T | null): T {
  if (value === null) throw new Error(UNEXPECTED_VIEW);
  return value;
}

export async function getConfig(rpcUrl: string, contract: string): Promise<MultisigConfig> {
  return checked(readMultisigConfig(await view(rpcUrl, contract, 'get_config', {})));
}

export async function nextProposalId(rpcUrl: string, contract: string): Promise<number> {
  return checked(readProposalId(await view(rpcUrl, contract, 'next_proposal_id', {})));
}

/** The newest 50 proposals, newest first. */
export async function getProposals(rpcUrl: string, contract: string): Promise<Proposal[]> {
  return checked(readProposals(await view(rpcUrl, contract, 'get_proposals', { from_index: 0, limit: 50 })));
}

/** The proposal, or null when the contract has none with this id. */
export async function getProposal(rpcUrl: string, contract: string, proposalId: number): Promise<Proposal | null> {
  const value = await view(rpcUrl, contract, 'get_proposal', { proposal_id: proposalId });
  return value === null ? null : checked(readProposal(value));
}

/** The NEAR balance of the multisig account, in yoctoNEAR. */
export async function getBalance(rpcUrl: string, accountId: string): Promise<string> {
  const result = await rpcQuery(rpcUrl, { request_type: 'view_account', account_id: accountId });
  if (!isDecimalText(result.amount)) throw new Error('NEAR RPC gave no balance.');
  return result.amount;
}
