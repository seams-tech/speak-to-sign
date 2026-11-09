import type {
  SpeakToSignEnrollmentResult,
  SpeakToSignHostEnrollment,
  SpeakToSignPrompt,
} from '@seams/wallet/speak-to-sign-host';
import { enrolledView, enrollSavingView, enrollSigningView, notEnrolledView } from './card';
import { recordClip, withPrompt } from './prompt';
import { shortDetail, verifierUnavailable } from './result';
import { enrollInput, readEnrollmentOutput } from './verifier';

/** The owner reads these three phrases. The verifier needs exactly three recordings. */
export const ENROLLMENT_PHRASES = [
  'My voice is my signature for this wallet.',
  'I send money only when I say so.',
  'Seams, please learn how I sound today.',
] as const;

/**
 * One enrollment: record the three phrases on the VoiceID surface, have the owner sign one
 * message that authorizes exactly these recordings, then ask the verifier to store the
 * template. The verifier checks that a full-access key of the owner signed the message.
 *
 * The card of the third phrase stays open until the end, so no gap shows while core prepares
 * the message: it shows the wait, the Wallet confirm opens over it (a modal dialog), and then it
 * shows the verifier's work and the result.
 */
export async function runEnrollment(
  input: SpeakToSignHostEnrollment,
): Promise<SpeakToSignEnrollmentResult> {
  const clips: Uint8Array<ArrayBuffer>[] = [];
  for (const sentence of ENROLLMENT_PHRASES.slice(0, -1)) {
    const clip = await withPrompt(input.operations, promptRequest(input, sentence), recordClip);
    if (clip.kind !== 'captured') return clip;
    clips.push(clip.wav);
  }
  const lastPhrase = ENROLLMENT_PHRASES[ENROLLMENT_PHRASES.length - 1];
  return await withPrompt(input.operations, promptRequest(input, lastPhrase), async (prompt) => {
    const clip = await recordClip(prompt);
    if (clip.kind !== 'captured') return clip;
    return await enrollOnCard(input, [...clips, clip.wav], prompt);
  });
}

function promptRequest(input: SpeakToSignHostEnrollment, sentence: string) {
  return {
    sentence,
    signal: input.signal,
    surfaceMeasurementBinding: input.surfaceMeasurementBinding,
  };
}

async function enrollOnCard(
  input: SpeakToSignHostEnrollment,
  clips: readonly Uint8Array<ArrayBuffer>[],
  prompt: SpeakToSignPrompt,
): Promise<SpeakToSignEnrollmentResult> {
  const { operations, signal } = input;
  void prompt.show(enrollSigningView());
  const signed = await operations.authorizeEnrollment(clips, signal);
  if (signed.kind === 'not_signed') {
    return { kind: 'unavailable', reason: 'not_submitted', detail: shortDetail(signed.error) };
  }

  void prompt.show(enrollSavingView());
  const reply = await operations.verify(
    enrollInput(input.ownerAccountId, clips, signed.authorization),
    signal,
  );
  const result: SpeakToSignEnrollmentResult =
    reply.kind === 'failed' ? verifierUnavailable(reply.code) : readEnrollmentOutput(reply.output);
  switch (result.kind) {
    case 'enrolled':
      await prompt.show(enrolledView(result.templateEpoch, result.agreementMilli));
      break;
    case 'refused':
    case 'unavailable':
      await prompt.show(notEnrolledView(result));
      break;
    case 'cancelled':
      break;
  }
  return result;
}
