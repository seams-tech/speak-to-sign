const contract = (import.meta.env.VITE_NOTES_CONTRACT ?? '').trim();

export const config = {
  /** The notes contract on NEAR testnet. Empty means mock mode. */
  contract,
  mock: contract === '',
  rpcUrl: (import.meta.env.VITE_NEAR_RPC_URL ?? '').trim() || 'https://test.rpc.fastnear.com',
  explorerUrl: (import.meta.env.VITE_NEAR_EXPLORER_URL ?? '').trim() || 'https://testnet.nearblocks.io',
};

export function transactionUrl(hash: string): string {
  return `${config.explorerUrl}/txns/${encodeURIComponent(hash)}`;
}

export function shortHash(hash: string): string {
  return hash.length > 12 ? `${hash.slice(0, 6)}…${hash.slice(-4)}` : hash;
}
