import type { SeamsConfigsInput } from '@seams/wallet';
import { speakToSign } from '@seams/speak-to-sign';
import { voiceIdAuthMethod } from '@seams/voiceid';
import { config } from '../config';

/** The SeamsWeb configuration of the staging testnet lane, with VoiceID and Speak-to-Sign. */
export function buildSeamsConfig(): SeamsConfigsInput {
  const { seams } = config;
  return {
    authMethods: [voiceIdAuthMethod()],
    transactionFeatures: [speakToSign({ network: 'testnet' })],
    iframeWallet: {
      walletOrigin: seams.walletOrigin,
      walletServicePath: seams.walletServicePath,
      sdkBasePath: seams.sdkBasePath,
      rpIdOverride: seams.rpId,
    },
    relayer: { url: seams.relayerUrl },
    signingSessionPersistenceMode: 'sealed_refresh_v1',
    routerAb: { normalSigning: { mode: 'enabled', signingWorkerId: seams.signingWorkerId } },
    appearance: { locale: 'en' },
  };
}
