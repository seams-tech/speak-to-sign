import type { SeamsConfigsInput } from '@seams/wallet';
import { seamsTestnetConfig } from '@seams/wallet/react';
import { speakToSign } from '@seams/speak-to-sign';
import { voiceIdAuthMethod } from '@seams/voiceid';
import { config } from '../config';

/**
 * The SeamsWeb configuration with VoiceID and Speak-to-Sign on NEAR testnet, as in the Speak to
 * pay example. Null when the build has no publishable key: the page then shows the notes, and
 * the setup panel says what is missing.
 */
export function buildSeamsConfig(): SeamsConfigsInput | null {
  const { seams } = config;
  if (!seams.publishableKey) return null;
  return {
    ...seamsTestnetConfig({
      walletOrigin: seams.walletOrigin,
      relayerUrl: seams.relayerUrl,
      publishableKey: seams.publishableKey,
      ...(seams.projectEnvironmentId ? { projectEnvironmentId: seams.projectEnvironmentId } : {}),
      chains: [{ network: 'near-testnet' }],
      // seamsTestnetConfig keeps the SDK default RP ID, "example.localhost". A passkey made in
      // the Wallet iframe must use the Wallet host's RP ID, as the staging console does.
      iframeWallet: { rpIdOverride: seams.rpId },
    }),
    // Managed registration (a publishable key) needs Router A/B normal signing, as in the
    // staging console. The SDK default turns it off.
    // SDK 0.60.0 sets both this and the RP ID itself (seams-wallet 1b5f1da1a, bdcc7cd50):
    // delete rpIdOverride and routerAb here when the page moves to 0.60.0.
    routerAb: { normalSigning: { mode: 'enabled', signingWorkerId: seams.signingWorkerId } },
    signingSessionPersistenceMode: 'sealed_refresh_v1',
    appearance: { locale: 'en' },
    authMethods: [voiceIdAuthMethod()],
    transactionFeatures: [speakToSign({ network: 'testnet' })],
  };
}
