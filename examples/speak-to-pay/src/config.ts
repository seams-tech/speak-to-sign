import type { SeamsConfigsInput } from '@seams/wallet';
import { seamsTestnetConfig } from '@seams/wallet/react';
import { voiceIdAuthMethod } from '@seams/voiceid';
import { speakToSign } from '@seams/speak-to-sign';

/* Settings come from Vite env variables at build time (see .env.example).
   Speak-to-Sign runs only on NEAR testnet, against a Seams deployment that
   serves the verify route. The defaults are the Seams staging deployment. */

const DEFAULT_WALLET_ORIGIN = 'https://staging.sign.seams.sh';
const DEFAULT_RELAYER_URL = 'https://staging.api.wallet.seams.sh';
const DEFAULT_NEAR_RPC_URL = 'https://test.rpc.fastnear.com';
/* The passkey RP ID must be the Wallet host or a parent domain of it.
   seamsTestnetConfig keeps the SDK default "example.localhost", and then
   "Create wallet with passkey" fails. The staging console uses this value. */
const DEFAULT_RP_ID = 'staging.sign.seams.sh';
/* Managed registration (a publishable key) needs Router A/B normal signing,
   which the SDK default turns off. This is the staging signing worker. */
const DEFAULT_SIGNING_WORKER_ID = 'router-ab-signing-worker-staging';
/* SDK 0.60.0 sets the RP ID and the signing worker itself (seams-wallet 1b5f1da1a,
   bdcc7cd50). Delete both settings when this example moves to 0.60.0. */

export type Settings =
  | Readonly<{ kind: 'ready'; seamsConfig: SeamsConfigsInput; nearRpcUrl: string }>
  | Readonly<{ kind: 'missing'; names: readonly string[] }>;

function read(value: string | undefined): string {
  return (value ?? '').trim();
}

export function readSettings(): Settings {
  const publishableKey = read(import.meta.env.VITE_SEAMS_PUBLISHABLE_KEY);
  if (!publishableKey) return { kind: 'missing', names: ['VITE_SEAMS_PUBLISHABLE_KEY'] };
  const projectEnvironmentId = read(import.meta.env.VITE_SEAMS_PROJECT_ENVIRONMENT_ID);
  const seamsConfig: SeamsConfigsInput = {
    ...seamsTestnetConfig({
      walletOrigin: read(import.meta.env.VITE_SEAMS_WALLET_ORIGIN) || DEFAULT_WALLET_ORIGIN,
      relayerUrl: read(import.meta.env.VITE_SEAMS_RELAYER_URL) || DEFAULT_RELAYER_URL,
      publishableKey,
      ...(projectEnvironmentId ? { projectEnvironmentId } : {}),
      chains: [{ network: 'near-testnet' }],
      iframeWallet: { rpIdOverride: read(import.meta.env.VITE_SEAMS_RP_ID) || DEFAULT_RP_ID },
    }),
    routerAb: {
      normalSigning: {
        mode: 'enabled',
        signingWorkerId: read(import.meta.env.VITE_SEAMS_SIGNING_WORKER_ID) || DEFAULT_SIGNING_WORKER_ID,
      },
    },
    signingSessionPersistenceMode: 'sealed_refresh_v1',
    appearance: { locale: 'en' },
    // VoiceID records the spoken sentence; Speak-to-Sign verifies it and pays.
    authMethods: [voiceIdAuthMethod()],
    transactionFeatures: [speakToSign({ network: 'testnet' })],
  };
  return {
    kind: 'ready',
    seamsConfig,
    nearRpcUrl: read(import.meta.env.VITE_NEAR_RPC_URL) || DEFAULT_NEAR_RPC_URL,
  };
}
