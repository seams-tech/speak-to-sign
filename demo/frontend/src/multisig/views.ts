// Reads the voice multisig contract (demo/contracts/voice-multisig) with its views over NEAR
// JSON-RPC: `get_config`, `get_proposals`, `get_proposal` and `next_proposal_id`.

export interface MultisigConfig {
  members: string[];
  threshold: number;
  verifier_public_key: string;
}

export interface Proposal {
  id: number;
  commitment_hex: string;
  proposer: string;
  confirmations: string[];
  /** `open` or `executed`. */
  status: string;
  /** Only after a successful `execute`. */
  receiver?: string | null;
  amount_yocto?: string | null;
}

interface RpcResponse {
  result?: { result?: number[]; error?: string };
  error?: { message?: string; cause?: { name?: string } };
}

const RPC_ERRORS: Record<string, string> = {
  UNKNOWN_ACCOUNT: 'the multisig contract account does not exist yet.',
  NO_CONTRACT_CODE: 'the multisig contract account has no contract code yet.',
  CONTRACT_EXECUTION_ERROR: 'the contract view failed.',
};

async function view<T>(rpcUrl: string, contract: string, method: string, args: Record<string, unknown>): Promise<T> {
  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'multisig-demo',
      method: 'query',
      params: {
        request_type: 'call_function',
        finality: 'optimistic',
        account_id: contract,
        method_name: method,
        args_base64: btoa(JSON.stringify(args)),
      },
    }),
  });
  if (!response.ok) throw new Error(`NEAR RPC answered ${response.status}.`);
  const body = (await response.json()) as RpcResponse;
  if (body.error) {
    const cause = body.error.cause?.name;
    throw new Error((cause && RPC_ERRORS[cause]) ?? cause ?? body.error.message ?? 'NEAR RPC error.');
  }
  if (body.result?.error) throw new Error(body.result.error);
  const bytes = body.result?.result;
  if (!bytes) throw new Error('NEAR RPC gave no result.');
  return JSON.parse(new TextDecoder().decode(new Uint8Array(bytes))) as T;
}

export const getConfig = (rpcUrl: string, contract: string) => view<MultisigConfig>(rpcUrl, contract, 'get_config', {});

export const nextProposalId = (rpcUrl: string, contract: string) => view<number>(rpcUrl, contract, 'next_proposal_id', {});

/** The newest 50 proposals, newest first. */
export async function getProposals(rpcUrl: string, contract: string): Promise<Proposal[]> {
  const list = await view<unknown>(rpcUrl, contract, 'get_proposals', { from_index: 0, limit: 50 });
  return Array.isArray(list) ? (list as Proposal[]) : [];
}

export const getProposal = (rpcUrl: string, contract: string, proposalId: number) =>
  view<Proposal | null>(rpcUrl, contract, 'get_proposal', { proposal_id: proposalId });

/** The NEAR balance of the multisig account, in yoctoNEAR. */
export async function getBalance(rpcUrl: string, accountId: string): Promise<string> {
  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'multisig-demo',
      method: 'query',
      params: { request_type: 'view_account', finality: 'optimistic', account_id: accountId },
    }),
  });
  if (!response.ok) throw new Error(`NEAR RPC answered ${response.status}.`);
  const body = (await response.json()) as { result?: { amount?: string }; error?: { message?: string } };
  if (!body.result?.amount) throw new Error(body.error?.message ?? 'NEAR RPC gave no balance.');
  return body.result.amount;
}
