// Build-time settings. The Seams defaults are the staging deployment, the only one whose
// Seams server runs the Speak-to-Sign verifier. The same Seams project and key serve the
// Speak to pay page at /pay/ (examples/speak-to-pay), so one wallet works on both.

function env(value: string | undefined, fallback = ''): string {
  const trimmed = (value ?? '').trim();
  return trimmed === '' ? fallback : trimmed;
}

const e = import.meta.env;

export const config = {
  /** The notes contract on NEAR testnet (demo/contracts/community-notes/). */
  contract: env(e.VITE_NOTES_CONTRACT, 'notes.seams-v1.testnet'),
  rpcUrl: env(e.VITE_NEAR_RPC_URL, 'https://test.rpc.fastnear.com'),
  /** The note market contract on NEAR testnet (demo/contracts/jev-prediction-market/). */
  marketContract: env(e.VITE_MARKET_CONTRACT, 'pm-notes.seams-v1.testnet'),
  /** The money of the note markets: NEAR testnet USDC (Circle, NEP-141, 6 decimals). */
  marketToken: env(e.VITE_MARKET_TOKEN, '3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af'),
  /** The RPC for the market views. A local sandbox can stand in for testnet in a test. */
  marketRpcUrl: env(e.VITE_MARKET_RPC_URL, env(e.VITE_NEAR_RPC_URL, 'https://test.rpc.fastnear.com')),
  explorerUrl: env(e.VITE_NEAR_EXPLORER_URL, 'https://testnet.nearblocks.io'),
  /** FastNEAR's transactions API: the page finds the transaction of each note with it. */
  txApiUrl: env(e.VITE_NEAR_TX_API_URL, 'https://tx.test.fastnear.com'),
  faucetUrl: 'https://docs.near.org/getting-started/faucet',
  usdcFaucetUrl: 'https://faucet.circle.com',
  /** The Speak to pay page on the same site. */
  payPath: '/pay/',
  seams: {
    /** The publishable key of the Seams project environment. It allows only the project's origins. */
    publishableKey: env(e.VITE_SEAMS_PUBLISHABLE_KEY),
    projectEnvironmentId: env(e.VITE_SEAMS_PROJECT_ENVIRONMENT_ID),
    walletOrigin: env(e.VITE_SEAMS_WALLET_ORIGIN, 'https://staging.sign.seams.sh'),
    relayerUrl: env(e.VITE_SEAMS_RELAYER_URL, 'https://staging.api.wallet.seams.sh'),
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
