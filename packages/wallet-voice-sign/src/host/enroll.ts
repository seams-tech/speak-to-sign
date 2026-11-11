import type {
  SpeakToSignClipHandle,
  SpeakToSignEnrollmentResult,
  SpeakToSignHostEnrollment,
} from '@seams/wallet/speak-to-sign-host';
import { enrolledView, enrollSavingView, enrollSigningView, notEnrolledView } from './card';
import { shortDetail, verifierUnavailable, voiceIdUnavailable } from './result';
import { readEnrollmentOutput } from './verifier';

/**
 * One enrollment: record the phrases of Wallet core on the VoiceID surface, then ask core to
 * enroll exactly these recordings. Core has the owner sign one message that authorizes them
 * and sends them, sealed, to the verifier, which stores the template. The plugin holds no
 * audio: each recording is a handle of core.
 *
 * The card of the last phrase stays open until the end, so no gap shows while core prepares
 * the message: it shows the wait, steps aside while the Wallet confirm is open, and then it
 * shows the verifier's work and the result.
 *
 * When VoiceID was turned on in the same flow, its samples are the recordings, so the owner
 * records one set for both.
 */
export async function runEnrollment(
  input: SpeakToSignHostEnrollment,
): Promise<SpeakToSignEnrollmentResult> {
  const { operations } = input;
  let clips = input.clips;
  if (!clips) {
    const recorded: SpeakToSignClipHandle[] = [];
    for (let index = 0; index < input.phraseCount; index += 1) {
      const clip = await operations.record(index);
      if (clip.kind === 'cancelled') return clip;
      if (clip.kind === 'unavailable') return voiceIdUnavailable(clip.detail);
      recorded.push(clip);
    }
    clips = recorded;
  }

  void operations.show(enrollSigningView());
  const reply = await operations.enrollClips(
    clips,
    () => void operations.show(enrollSavingView()),
  );
  if (reply.kind === 'not_signed') {
    return { kind: 'unavailable', reason: 'not_submitted', detail: shortDetail(reply.error) };
  }
  const result: SpeakToSignEnrollmentResult =
    reply.kind === 'failed' ? verifierUnavailable(reply.code) : readEnrollmentOutput(reply.output);
  switch (result.kind) {
    case 'enrolled':
      await operations.show(enrolledView(result.templateEpoch, result.agreementMilli));
      break;
    case 'refused':
    case 'unavailable':
      await operations.show(notEnrolledView(result));
      break;
    case 'cancelled':
      break;
  }
  return result;
}
