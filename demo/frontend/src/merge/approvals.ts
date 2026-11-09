// Reads approvals from the merge approvals contract with the view `get_approvals`.

export interface Approval {
  id: number;
  repo: string;
  pull_request: number;
  base: string;
  head_commit: string;
  approver: string;
  approved_at_ms: number;
}

interface RpcResponse {
  result?: { result?: number[]; error?: string };
  error?: { message?: string; cause?: { name?: string } };
}

const RPC_ERRORS: Record<string, string> = {
  UNKNOWN_ACCOUNT: 'the merge approvals contract account does not exist yet.',
  NO_CONTRACT_CODE: 'the merge approvals contract account has no contract code yet.',
  CONTRACT_EXECUTION_ERROR: 'the contract view failed.',
};

export async function getApprovals(rpcUrl: string, contract: string, repo: string, pullRequest: number): Promise<Approval[]> {
  const args = btoa(JSON.stringify({ repo, pull_request: pullRequest }));
  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'merge-demo',
      method: 'query',
      params: {
        request_type: 'call_function',
        finality: 'optimistic',
        account_id: contract,
        method_name: 'get_approvals',
        args_base64: args,
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
  const approvals = JSON.parse(new TextDecoder().decode(new Uint8Array(bytes))) as unknown;
  return Array.isArray(approvals) ? (approvals as Approval[]) : [];
}
