// Build-time settings. The defaults are the Seams staging testnet lane, the only lane whose
// Seams server runs the Speak-to-Sign verifier.

function env(value: string | undefined, fallback: string): string {
  const trimmed = (value ?? '').trim();
  return trimmed === '' ? fallback : trimmed;
}

const e = import.meta.env;

export const config = {
  /** The notes contract on NEAR testnet (community-notes/). */
  contract: env(e.VITE_NOTES_CONTRACT, 'notes.seams-v1.testnet'),
  rpcUrl: env(e.VITE_NEAR_RPC_URL, 'https://test.rpc.fastnear.com'),
  explorerUrl: env(e.VITE_NEAR_EXPLORER_URL, 'https://testnet.nearblocks.io'),
  faucetUrl: 'https://docs.near.org/getting-started/faucet',
  seams: {
    walletOrigin: env(e.VITE_SEAMS_WALLET_ORIGIN, 'https://staging.sign.seams.sh'),
    relayerUrl: env(e.VITE_SEAMS_RELAYER_URL, 'https://staging.api.wallet.seams.sh'),
    rpId: env(e.VITE_SEAMS_RP_ID, 'staging.sign.seams.sh'),
    signingWorkerId: env(e.VITE_SEAMS_SIGNING_WORKER_ID, 'router-ab-signing-worker-staging'),
    walletServicePath: '/wallet-service',
    sdkBasePath: '/sdk',
  },
};

export function transactionUrl(hash: string): string {
  return `${config.explorerUrl}/txns/${encodeURIComponent(hash)}`;
}

export function accountUrl(accountId: string): string {
  return `${config.explorerUrl}/address/${encodeURIComponent(accountId)}`;
}

export function shortHash(hash: string): string {
  return hash.length > 12 ? `${hash.slice(0, 6)}…${hash.slice(-4)}` : hash;
}

/** Shortens an implicit (64-hex) account for display. Named accounts stay as they are. */
export function shortAccount(accountId: string): string {
  return /^[0-9a-f]{64}$/.test(accountId) ? `${accountId.slice(0, 6)}…${accountId.slice(-4)}` : accountId;
}
