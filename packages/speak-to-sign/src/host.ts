import type {
  SPEAK_TO_SIGN_HOST_API_VERSION,
  SpeakToSignEnrollmentResult,
  SpeakToSignHostEnrollment,
  SpeakToSignHostPlugin,
  SpeakToSignMessageResult,
  SpeakToSignNoteResult,
  SpeakToSignTransferResult,
} from '@seams/wallet/speak-to-sign-host';

// The type makes a Wallet with a different host API version fail to compile.
export const hostApiVersion: typeof SPEAK_TO_SIGN_HOST_API_VERSION = 10;

type TransferInput = Parameters<SpeakToSignHostPlugin['requestTransfer']>[0];
type NoteInput = Parameters<SpeakToSignHostPlugin['requestNoteAction']>[0];
type MessageInput = Parameters<SpeakToSignHostPlugin['requestMessage']>[0];

export function createSpeakToSignHostPlugin(): SpeakToSignHostPlugin {
  return { requestTransfer, requestNoteAction, requestMessage, enroll };
}

async function requestTransfer(input: TransferInput): Promise<SpeakToSignTransferResult> {
  input.signal.throwIfAborted();
  // The Wallet iframe route always sends a transfer. A caller without one has no payment to run.
  if (!input.transfer) return { kind: 'unavailable', reason: 'flow_not_available' };
  const { runSpokenTransfer } = await import('./host/flow');
  input.signal.throwIfAborted();
  return await runSpokenTransfer({ ...input, transfer: input.transfer });
}

async function requestNoteAction(input: NoteInput): Promise<SpeakToSignNoteResult> {
  input.signal.throwIfAborted();
  const { runSpokenNote } = await import('./host/flow');
  input.signal.throwIfAborted();
  return await runSpokenNote(input);
}

async function requestMessage(input: MessageInput): Promise<SpeakToSignMessageResult> {
  input.signal.throwIfAborted();
  const { runSpokenMessage } = await import('./host/flow');
  input.signal.throwIfAborted();
  return await runSpokenMessage(input);
}

async function enroll(input: SpeakToSignHostEnrollment): Promise<SpeakToSignEnrollmentResult> {
  input.signal.throwIfAborted();
  const { runEnrollment } = await import('./host/enroll');
  input.signal.throwIfAborted();
  return await runEnrollment(input);
}
