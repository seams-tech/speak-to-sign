import {
  base64UrlEncode,
  isPlainObject,
  type SpeakToSignEnrollmentResult,
  type SpeakToSignHostEnrollment,
} from '@seams/wallet/speak-to-sign-host';
import { concat, sha256, utf8 } from './intent';
import { base64Standard } from './verdict';

const ENROLLMENT_DOMAIN = 'seams:voice-enrollment:v1';
const ENROLLMENT_OUTPUT_KIND = 'seams_voice_enrollment_v2';

/** The owner reads these three phrases. The verifier needs exactly three recordings. */
export const ENROLLMENT_PHRASES = [
  'My voice is my signature for this vault.',
  'I send money only to the contacts I saved.',
  'Seams, please learn how I sound today.',
] as const;

/** The verifier reads the authorization at finality `final`, about two blocks after it lands. */
const AUTHORIZATION_POLL_MS = 1_000;
const AUTHORIZATION_WAIT_MS = 30_000;

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
 * One enrollment: record the three phrases on the VoiceID surface, authorize exactly these
 * recordings on the vault, wait until the vault shows the authorization, then ask the verifier
 * to store the template. The verifier enrolls nothing that the owner did not authorize.
 */
export async function runEnrollment(
  input: SpeakToSignHostEnrollment,
): Promise<SpeakToSignEnrollmentResult> {
  const { operations, signal } = input;
  try {
    if ((await operations.viewVault('get_vault', signal)) === null) {
      return { kind: 'unavailable', reason: 'vault_missing' };
    }
  } catch (error) {
    signal.throwIfAborted();
    return { kind: 'unavailable', reason: 'verifier_unavailable', detail: message(error) };
  }

  const clips: Uint8Array<ArrayBuffer>[] = [];
  for (const sentence of ENROLLMENT_PHRASES) {
    const clip = await operations.captureClip({
      sentence,
      signal,
      surfaceMeasurementBinding: input.surfaceMeasurementBinding,
    });
    if (clip.kind === 'cancelled') return clip;
    if (clip.kind === 'unavailable') {
      return { kind: 'unavailable', reason: 'voiceid_unavailable', detail: clip.detail };
    }
    clips.push(clip.wav);
  }

  const digest = await enrollmentDigest(input.vault, input.ownerAccountId, clips);
  const submission = await operations.authorizeEnrollment(digest, signal);
  switch (submission.kind) {
    case 'executed':
      break;
    case 'reverted':
      return { kind: 'refused', reason: 'vault_rejected', detail: submission.error };
    case 'not_submitted':
    case 'submission_unknown':
      return { kind: 'unavailable', reason: submission.kind, detail: submission.error };
    default:
      return submission satisfies never;
  }

  const authorized = await waitForAuthorization(input, digest);
  if (!authorized) {
    return {
      kind: 'unavailable',
      reason: 'verifier_unavailable',
      detail: 'The vault did not show the enrollment authorization.',
    };
  }

  const reply = await operations.verify(
    {
      op: 'enroll',
      vault: input.vault,
      owner: input.ownerAccountId,
      audio_wav_b64: clips.map(base64Standard),
    },
    signal,
  );
  if (reply.kind === 'failed') {
    return { kind: 'unavailable', reason: 'verifier_unavailable', detail: reply.code };
  }
  return readEnrollmentOutput(reply.output, submission.transactionHash);
}

/** base64url SHA-256(domain || vault || 0 || owner || 0 || SHA-256 of each WAV, in order). */
export async function enrollmentDigest(
  vault: string,
  owner: string,
  clips: readonly Uint8Array<ArrayBuffer>[],
): Promise<string> {
  const digests = await Promise.all(clips.map(sha256));
  const zero = new Uint8Array(1);
  const preimage = concat([
    utf8(ENROLLMENT_DOMAIN),
    utf8(vault),
    zero,
    utf8(owner),
    zero,
    ...digests,
  ]);
  return base64UrlEncode(await sha256(preimage));
}

async function waitForAuthorization(
  input: SpeakToSignHostEnrollment,
  digest: string,
): Promise<boolean> {
  const deadline = performance.now() + AUTHORIZATION_WAIT_MS;
  for (;;) {
    try {
      const pending = await input.operations.viewVault('get_pending_enrollment', input.signal);
      if (isPlainObject(pending) && pending.enrollment_digest === digest) return true;
    } catch {
      input.signal.throwIfAborted();
    }
    if (performance.now() >= deadline) return false;
    await delay(AUTHORIZATION_POLL_MS, input.signal);
  }
}

/** Reads the verifier's `enroll` output that the Seams route passes through unchanged. */
export function readEnrollmentOutput(
  output: unknown,
  transactionHash: string,
): SpeakToSignEnrollmentResult {
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
    return {
      kind: 'enrolled',
      templateEpoch: epoch as number,
      agreementMilli: agreement as number,
      transactionHash,
    };
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

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(done, ms);
    signal.addEventListener('abort', aborted, { once: true });
    function done() {
      signal.removeEventListener('abort', aborted);
      resolve();
    }
    function aborted() {
      clearTimeout(timer);
      reject(signal.reason);
    }
  });
}

function message(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 200) : 'vault view failed';
}
