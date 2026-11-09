import {
  base64Encode,
  isPlainObject,
  type SpeakToSignEnrollmentResult,
  type SpeakToSignHostEnrollment,
  type SpeakToSignPrompt,
} from '@seams/wallet/speak-to-sign-host';
import { enrolledView, enrollSavingView, enrollSigningView, notEnrolledView } from './card';

const ENROLLMENT_OUTPUT_KIND = 'seams_voice_enrollment_v3';

/** The owner reads these three phrases. The verifier needs exactly three recordings. */
export const ENROLLMENT_PHRASES = [
  'My voice is my signature for this wallet.',
  'I send money only when I say so.',
  'Seams, please learn how I sound today.',
] as const;

const ENROLLMENT_REFUSALS = [
  'quality',
  'speaker',
  'audio_reused',
  'audio_invalid',
  'unsupported',
  'speaker_unavailable',
  'storage',
  'template_exists',
  'not_authorized',
  'authorization_unavailable',
] as const;
type VerifierEnrollmentRefusal = (typeof ENROLLMENT_REFUSALS)[number];

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
  const recorded = await recordPhrases(input);
  if (recorded.kind === 'stopped') return recorded.result;
  const { clips, prompt } = recorded;
  try {
    return await enrollOnCard(input, clips, prompt);
  } finally {
    prompt.close();
  }
}

type Recorded =
  | Readonly<{ kind: 'recorded'; clips: Uint8Array<ArrayBuffer>[]; prompt: SpeakToSignPrompt }>
  | Readonly<{ kind: 'stopped'; result: SpeakToSignEnrollmentResult }>;

/** Records the three phrases. The card of the last one stays open for the caller. */
async function recordPhrases(input: SpeakToSignHostEnrollment): Promise<Recorded> {
  const { operations, signal } = input;
  const clips: Uint8Array<ArrayBuffer>[] = [];
  for (const [index, sentence] of ENROLLMENT_PHRASES.entries()) {
    const opened = await operations.openPrompt({
      sentence,
      signal,
      surfaceMeasurementBinding: input.surfaceMeasurementBinding,
    });
    if (opened.kind === 'unavailable') {
      const result: SpeakToSignEnrollmentResult = {
        kind: 'unavailable',
        reason: 'voiceid_unavailable',
        detail: opened.detail,
      };
      return { kind: 'stopped', result };
    }
    const { prompt } = opened;
    const clip = await prompt.record().catch((error: unknown) => {
      prompt.close();
      throw error;
    });
    if (clip.kind !== 'captured') {
      prompt.close();
      const result: SpeakToSignEnrollmentResult =
        clip.kind === 'cancelled'
          ? clip
          : { kind: 'unavailable', reason: 'voiceid_unavailable', detail: clip.detail };
      return { kind: 'stopped', result };
    }
    clips.push(clip.wav);
    if (index === ENROLLMENT_PHRASES.length - 1) return { kind: 'recorded', clips, prompt };
    prompt.close();
  }
  throw new Error('The enrollment has no phrases.');
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
    return { kind: 'unavailable', reason: 'not_submitted', detail: signed.error.slice(0, 200) };
  }

  void prompt.show(enrollSavingView());
  const reply = await operations.verify(
    {
      op: 'enroll',
      owner: input.ownerAccountId,
      audio_wav_b64: clips.map(base64Encode),
      authorization: signed.authorization,
    },
    signal,
  );
  const result: SpeakToSignEnrollmentResult =
    reply.kind === 'failed'
      ? { kind: 'unavailable', reason: 'verifier_unavailable', detail: reply.code }
      : readEnrollmentOutput(reply.output);
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

/** Reads the verifier's `enroll` output that the Seams route passes through unchanged. */
export function readEnrollmentOutput(output: unknown): SpeakToSignEnrollmentResult {
  if (!isPlainObject(output) || output.kind !== ENROLLMENT_OUTPUT_KIND) {
    return { kind: 'unavailable', reason: 'verifier_unavailable', detail: 'invalid output' };
  }
  const detail = typeof output.detail === 'string' ? output.detail.slice(0, 200) : undefined;
  if (output.outcome === 'accept') {
    const epoch = output.template_epoch;
    const agreement = output.agreement_milli;
    if (!Number.isSafeInteger(epoch) || (epoch as number) < 1 || !Number.isSafeInteger(agreement)) {
      return { kind: 'unavailable', reason: 'verifier_unavailable', detail: 'invalid output' };
    }
    return { kind: 'enrolled', templateEpoch: epoch as number, agreementMilli: agreement as number };
  }
  const reason = ENROLLMENT_REFUSALS.find(isReason.bind(null, output.reason));
  if (output.outcome !== 'refuse' || reason === undefined) {
    return { kind: 'unavailable', reason: 'verifier_unavailable', detail: 'invalid output' };
  }
  return detail === undefined ? { kind: 'refused', reason } : { kind: 'refused', reason, detail };
}

function isReason(value: unknown, reason: VerifierEnrollmentRefusal): boolean {
  return value === reason;
}
