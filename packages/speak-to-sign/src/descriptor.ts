import type { SpeakToSignFeaturePlugin, SpeakToSignNetwork } from '@seams/wallet';

export type SpeakToSignOptions = Readonly<{
  /** NEAR account of the Speak-to-Sign vault contract. */
  vault: string;
  network: SpeakToSignNetwork;
}>;

/** A small opt-in descriptor. It loads no capture, model, WASM or host code. */
export function speakToSign(options: SpeakToSignOptions): SpeakToSignFeaturePlugin {
  return { kind: 'speak_to_sign', vault: options.vault, network: options.network };
}
