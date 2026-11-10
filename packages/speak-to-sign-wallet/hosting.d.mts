/** Compose Wallet, VoiceID and Speak-to-Sign assets into a new deployment directory. */
export function composeSpeakToSignWalletAssets(input: {
  walletPublicDirectory: string;
  outputDirectory: string;
}): Promise<string>;
