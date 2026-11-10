import type { SpeakToSignFeaturePlugin, SpeakToSignNetwork } from '@seams/wallet';

export type SpeakToSignOptions = Readonly<{
  /** Only `testnet` has a verifier today. */
  network: SpeakToSignNetwork;
}>;

/** A small opt-in descriptor. It loads no capture, model, WASM or host code. */
export function speakToSign(options: SpeakToSignOptions): SpeakToSignFeaturePlugin {
  return { kind: 'speak_to_sign', network: options.network };
}
