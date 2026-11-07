import type {
  SPEAK_TO_SIGN_HOST_API_VERSION,
  SpeakToSignHostPlugin,
  SpeakToSignTransferResult,
} from '@seams/wallet';

// The type makes a Wallet with a different host API version fail to compile.
export const hostApiVersion: typeof SPEAK_TO_SIGN_HOST_API_VERSION = 1;

type TransferInput = Parameters<SpeakToSignHostPlugin['requestTransfer']>[0];

export function createSpeakToSignHostPlugin(): SpeakToSignHostPlugin {
  return { requestTransfer };
}

// The spoken payment flow comes later. Until then, no request reaches the vault.
async function requestTransfer(input: TransferInput): Promise<SpeakToSignTransferResult> {
  input.signal.throwIfAborted();
  return { kind: 'unavailable', reason: 'flow_not_available' };
}
