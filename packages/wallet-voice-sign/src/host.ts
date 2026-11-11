import type {
  SPEAK_TO_SIGN_HOST_API_VERSION,
  SpeakToSignApprovalResult,
  SpeakToSignEnrollmentResult,
  SpeakToSignHostApproval,
  SpeakToSignHostEnrollment,
  SpeakToSignHostPlugin,
} from '@seams/wallet/speak-to-sign-host';

// The type makes a Wallet with a different host API version fail to compile.
export const hostApiVersion: typeof SPEAK_TO_SIGN_HOST_API_VERSION = 12;

export function createSpeakToSignHostPlugin(): SpeakToSignHostPlugin {
  return { approve, enroll };
}

async function approve(input: SpeakToSignHostApproval): Promise<SpeakToSignApprovalResult> {
  input.signal.throwIfAborted();
  const { runApproval } = await import('./host/flow');
  input.signal.throwIfAborted();
  return await runApproval(input);
}

async function enroll(input: SpeakToSignHostEnrollment): Promise<SpeakToSignEnrollmentResult> {
  input.signal.throwIfAborted();
  const { runEnrollment } = await import('./host/enroll');
  input.signal.throwIfAborted();
  return await runEnrollment(input);
}
