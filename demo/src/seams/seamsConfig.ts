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
    }),
    appearance: { locale: 'en' },
    authMethods: [voiceIdAuthMethod()],
    transactionFeatures: [speakToSign({ network: 'testnet' })],
  };
}
