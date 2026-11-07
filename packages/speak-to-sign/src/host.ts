import type {
  SPEAK_TO_SIGN_HOST_API_VERSION,
  SpeakToSignHostPlugin,
  SpeakToSignTransferResult,
} from '@seams/wallet/speak-to-sign-host';

// The type makes a Wallet with a different host API version fail to compile.
export const hostApiVersion: typeof SPEAK_TO_SIGN_HOST_API_VERSION = 1;

type TransferInput = Parameters<SpeakToSignHostPlugin['requestTransfer']>[0];

export function createSpeakToSignHostPlugin(): SpeakToSignHostPlugin {
  return { requestTransfer };
}

async function requestTransfer(input: TransferInput): Promise<SpeakToSignTransferResult> {
  input.signal.throwIfAborted();
  // The Wallet iframe route always sends a transfer. A caller without one has no payment to run.
  if (!input.transfer) return { kind: 'unavailable', reason: 'flow_not_available' };
  const { runSpokenTransfer } = await import('./host/flow');
  input.signal.throwIfAborted();
  return await runSpokenTransfer({ ...input, transfer: input.transfer });
}
