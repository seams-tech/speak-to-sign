import {
  base64Encode,
  isPlainObject,
  type SpeakToSignEnrollmentResult,
  type SpeakToSignHostEnrollment,
} from '@seams/wallet/speak-to-sign-host';

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
 */
export async function runEnrollment(
  input: SpeakToSignHostEnrollment,
): Promise<SpeakToSignEnrollmentResult> {
  const { operations, signal } = input;
  const clips: Uint8Array<ArrayBuffer>[] = [];
  for (const sentence of ENROLLMENT_PHRASES) {
    const opened = await operations.openPrompt({
      sentence,
      signal,
      surfaceMeasurementBinding: input.surfaceMeasurementBinding,
    });
    if (opened.kind === 'unavailable') {
      return { kind: 'unavailable', reason: 'voiceid_unavailable', detail: opened.detail };
    }
    const clip = await opened.prompt.record().finally(opened.prompt.close);
    if (clip.kind === 'cancelled') return clip;
    if (clip.kind === 'unavailable') {
      return { kind: 'unavailable', reason: 'voiceid_unavailable', detail: clip.detail };
    }
    clips.push(clip.wav);
  }

  const signed = await operations.authorizeEnrollment(clips, signal);
  if (signed.kind === 'not_signed') {
    return { kind: 'unavailable', reason: 'not_submitted', detail: signed.error.slice(0, 200) };
  }

  const reply = await operations.verify(
    {
      op: 'enroll',
      owner: input.ownerAccountId,
      audio_wav_b64: clips.map(base64Encode),
      authorization: signed.authorization,
    },
    signal,
  );
  if (reply.kind === 'failed') {
    return { kind: 'unavailable', reason: 'verifier_unavailable', detail: reply.code };
  }
  return readEnrollmentOutput(reply.output);
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
