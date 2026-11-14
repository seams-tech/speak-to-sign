import { spoken, type SeamsConfigsInput } from '@seams/wallet';
import { seamsTestnetConfig } from '@seams/wallet/react';
import { voiceIdAuthMethod } from '@seams/voiceid';

/* Settings come from Vite env variables at build time (see .env.example).
   Speak-to-Sign runs only on NEAR testnet, against a Seams deployment that
   serves the verify route. The defaults are the Seams staging deployment. */

const DEFAULT_WALLET_ORIGIN = 'https://staging.sign.seams.sh';
const DEFAULT_RELAYER_URL = 'https://staging.api.wallet.seams.sh';
const DEFAULT_NEAR_RPC_URL = 'https://test.rpc.fastnear.com';

export type Settings =
  | Readonly<{ kind: 'ready'; seamsConfig: SeamsConfigsInput; nearRpcUrl: string }>
  | Readonly<{ kind: 'missing'; names: readonly string[] }>;

function read(value: string | undefined): string {
  return (value ?? '').trim();
}

export function readSettings(): Settings {
  const publishableKey = read(import.meta.env.VITE_SEAMS_PUBLISHABLE_KEY);
  const projectEnvironmentId = read(import.meta.env.VITE_SEAMS_PROJECT_ENVIRONMENT_ID);
  const missing: string[] = [];
  if (!publishableKey) missing.push('VITE_SEAMS_PUBLISHABLE_KEY');
  if (!projectEnvironmentId) missing.push('VITE_SEAMS_PROJECT_ENVIRONMENT_ID');
  if (missing.length > 0) return { kind: 'missing', names: missing };
  const seamsConfig: SeamsConfigsInput = {
    ...seamsTestnetConfig({
      walletOrigin: read(import.meta.env.VITE_SEAMS_WALLET_ORIGIN) || DEFAULT_WALLET_ORIGIN,
      relayerUrl: read(import.meta.env.VITE_SEAMS_RELAYER_URL) || DEFAULT_RELAYER_URL,
      publishableKey,
      projectEnvironmentId,
      chains: [{ network: 'near-testnet' }],
    }),
    /* The SDK derives the passkey RP ID (the Wallet host) and the Router A/B
       signing worker from a Seams-hosted Wallet origin, so this config sets neither. */
    signingSessionPersistenceMode: 'sealed_refresh_v1',
    appearance: { locale: 'en' },
    // VoiceID records the spoken sentence; Speak-to-Sign verifies it and pays.
    authMethods: [voiceIdAuthMethod()],
    approvals: [spoken({ network: 'testnet' })],
  };
  return {
    kind: 'ready',
    seamsConfig,
    nearRpcUrl: read(import.meta.env.VITE_NEAR_RPC_URL) || DEFAULT_NEAR_RPC_URL,
  };
}
