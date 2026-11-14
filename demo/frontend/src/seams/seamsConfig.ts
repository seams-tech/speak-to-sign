import { spoken, type SeamsConfigsInput } from '@seams/wallet';
import { seamsTestnetConfig } from '@seams/wallet/react';
import { voiceIdAuthMethod } from '@seams/voiceid';
import { config } from '../config';

/**
 * The SeamsWeb configuration with VoiceID and Speak-to-Sign on NEAR testnet, as in the Speak to
 * pay example. Null when the build has no Seams key or environment ID: the page then shows the
 * notes, and the setup panel says what is missing.
 */
export function buildSeamsConfig(): SeamsConfigsInput | null {
  const { seams } = config;
  if (!seams.publishableKey || !seams.projectEnvironmentId) return null;
  return {
    ...seamsTestnetConfig({
      walletOrigin: seams.walletOrigin,
      relayerUrl: seams.relayerUrl,
      publishableKey: seams.publishableKey,
      projectEnvironmentId: seams.projectEnvironmentId,
      chains: [{ network: 'near-testnet' }],
    }),
    // SDK 0.60.0 derives the passkey RP ID (the Wallet host) and the Router A/B signing worker
    // of a Seams-hosted Wallet origin, so this config sets neither.
    signingSessionPersistenceMode: 'sealed_refresh_v1',
    appearance: { locale: 'en' },
    authMethods: [voiceIdAuthMethod()],
    approvals: [spoken({ network: 'testnet' })],
  };
}
