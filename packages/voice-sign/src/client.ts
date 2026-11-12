/**
 * A call of the Speak-to-Sign verifier, an OutLayer worker, over OutLayer's HTTPS API.
 *
 * Use it on a server. The payment key pays for the run, and it is the authority for the
 * enrollment of application owners (`app:<id>`), so it must not reach a browser.
 */

import type { IntentSpec } from '@seams/voice-verdict';

export interface VerifierConfig {
  /** The OutLayer API, for example `https://testnet-api.outlayer.ai`. */
  baseUrl: string;
  /** The OutLayer project of the verifier: `owner/project`. */
  project: string;
  /** Your OutLayer payment key. It goes only into the `X-Payment-Key` header. */
  paymentKey: string;
  /** The SHA-256 of the verifier WASM that you built or checked. Without it, the active version runs. */
  versionKey?: string;
  /** The OutLayer secrets profile that holds `NEAR_AI_API_KEY`. */
  secretsRef: { profile: string; account_id: string };
  /** Default: 60,000 ms, longer than the run limit and the time that OutLayer holds a job. */
  timeoutMs?: number;
  /**
   * Default: 10 billion instructions, 128 MB, 40 s. 40 s is above the verifier's own 30 s waits
   * for its models, so a slow model gives a signed refusal. The `local-speaker` variant needs more.
   */
  resourceLimits?: { max_instructions: number; max_memory_mb: number; max_execution_seconds: number };
  /**
   * The most that one call can cost, in the units of OutLayer's `compute_cost` (the header
   * `X-Compute-Limit`). Without it, OutLayer stops a run at its default limit: about 8.9 billion
   * instructions on testnet. The default variant uses far less. The `local-speaker` variant needs
   * more: an enrollment used 19.8 billion instructions and cost 20,843.
   */
  computeLimit?: number;
  /** Default: the global `fetch`. */
  fetch?: typeof fetch;
}

/** A request object of the verifier, by `kind`. `confirmationRequest` builds one. */
export type VerifierRequest = { kind: string } & Record<string, unknown>;

/**
 * One recording, in one of two fields, not both:
 * - `audio_wav_b64`: a 16 kHz mono PCM16 WAV, standard base64.
 * - `audio_sealed_b64`: that WAV sealed to the verifier's audio key with `sealAudio` of
 *   `@seams/voice-verdict`, standard base64. Only the verifier can open it. Verifier 0.12.0 and later.
 */
export type VerifierRecording = { audio_wav_b64: string; audio_sealed_b64?: never } | { audio_sealed_b64: string; audio_wav_b64?: never };

/** The recordings of an enrollment: exactly three, all plain or all sealed. */
export type VerifierRecordings =
  | { audio_wav_b64: string[]; audio_sealed_b64?: never }
  | { audio_sealed_b64: string[]; audio_wav_b64?: never };

export type VerifierInput =
  | ({
      op: 'enroll';
      owner: string;
      /** Only for a NEAR owner: the NEP-413 authorization. */
      authorization?: { public_key: string; signature_b64: string; nonce_b64: string };
    } & VerifierRecordings)
  | ({ op: 'verify'; owner: string; request: VerifierRequest; contacts: string[] } & VerifierRecording)
  | ({ op: 'select'; owner: string; requests: VerifierRequest[]; contacts: string[] } & VerifierRecording)
  | ({ op: 'transcribe'; owner: string } & VerifierRecording)
  | ({ op: 'detect'; owner: string; intents: readonly IntentSpec[] } & VerifierRecording);

/** The output of `verify` and `select`. Check it with `checkVerdict`: this object is not proof. */
export interface VerifyOutput {
  kind: 'seams_voice_verify_output_v2';
  verdict_json: string;
  signature_b64: string | null;
  /** The key that signed. Compare the verdict with the key that you pin, not with this one. */
  public_key: string | null;
  policy_text: string | null;
  ms: Record<string, number>;
  detail: string | null;
  /** `select` only: the index of the request that the owner said. */
  selected?: number;
}

/** The output of `transcribe`. Check it with `checkTranscript`. */
export interface TranscribeOutput {
  kind: 'seams_voice_transcript_output_v1';
  transcript_json: string;
  signature_b64: string | null;
  public_key: string | null;
  ms: Record<string, number>;
  detail: string | null;
}

/** The output of `detect`. Check it with `checkIntent`. */
export interface DetectOutput {
  kind: 'seams_voice_intent_output_v1';
  intent_json: string;
  signature_b64: string | null;
  public_key: string | null;
  ms: Record<string, number>;
  detail: string | null;
}

/** The output of `enroll`. */
export interface EnrollOutput {
  kind: 'seams_voice_enrollment_v3';
  verifier: string;
  owner: string | null;
  outcome: 'accept' | 'refuse';
  reason: string | null;
  agreement_milli: number | null;
  audio_digests: string[];
  enrollment_digest: string | null;
  template_epoch: number | null;
  /** The verdict key of your payment key. Pin it after your first enrollment. */
  verifier_public_key: string | null;
  ms: Record<string, number>;
  detail: string | null;
}

/** An output of the verifier that this client accepts. Its `kind` tells which one. */
export type VerifierOutput = EnrollOutput | VerifyOutput | TranscribeOutput | DetectOutput;

/** The call did not give an output of the verifier. */
export class VerifierCallError extends Error {
  override name = 'VerifierCallError';
  /** `timeout`, `network`, `http` (see `status`) or `output` (the run did not complete). */
  readonly code: 'timeout' | 'network' | 'http' | 'output';
  readonly status: number | undefined;

  constructor(code: VerifierCallError['code'], message: string, status?: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

const DEFAULT_LIMITS = { max_instructions: 10_000_000_000, max_memory_mb: 128, max_execution_seconds: 40 };

/** One call: the output, and where OutLayer serves the TDX attestation of the call. */
export interface VerifierCall<Output> {
  output: Output;
  callId: string | null;
  /** A path of the OutLayer API, for `fetchAttestation`. `null` if OutLayer gave none. */
  attestationUrl: string | null;
  /** The time of the run that OutLayer reports, in ms. It is longer than the worker's own `ms.total`. */
  timeMs: number | null;
  /** The instructions that the worker used. */
  instructions: number | null;
  /** The cost of the call, in OutLayer's units. */
  computeCost: string | null;
}

/** Runs one operation of the verifier and returns its output JSON. */
export async function callVerifier(config: VerifierConfig, input: Extract<VerifierInput, { op: 'enroll' }>): Promise<EnrollOutput>;
export async function callVerifier(
  config: VerifierConfig,
  input: Extract<VerifierInput, { op: 'verify' | 'select' }>,
): Promise<VerifyOutput>;
export async function callVerifier(
  config: VerifierConfig,
  input: Extract<VerifierInput, { op: 'transcribe' }>,
): Promise<TranscribeOutput>;
export async function callVerifier(config: VerifierConfig, input: Extract<VerifierInput, { op: 'detect' }>): Promise<DetectOutput>;
export async function callVerifier(config: VerifierConfig, input: VerifierInput): Promise<VerifierOutput> {
  return (await runVerifier(config, input)).output;
}

/** As `callVerifier`, and it also gives the attestation URL of the call. */
export async function callVerifierWithAttestation(
  config: VerifierConfig,
  input: Extract<VerifierInput, { op: 'enroll' }>,
): Promise<VerifierCall<EnrollOutput>>;
export async function callVerifierWithAttestation(
  config: VerifierConfig,
  input: Extract<VerifierInput, { op: 'verify' | 'select' }>,
): Promise<VerifierCall<VerifyOutput>>;
export async function callVerifierWithAttestation(
  config: VerifierConfig,
  input: Extract<VerifierInput, { op: 'transcribe' }>,
): Promise<VerifierCall<TranscribeOutput>>;
export async function callVerifierWithAttestation(
  config: VerifierConfig,
  input: Extract<VerifierInput, { op: 'detect' }>,
): Promise<VerifierCall<DetectOutput>>;
export async function callVerifierWithAttestation(config: VerifierConfig, input: VerifierInput): Promise<VerifierCall<VerifierOutput>> {
  return await runVerifier(config, input);
}

/**
 * Relays an input that this server does not read to the verifier, for a server between a
 * browser and the verifier. For example, the browser sealed the recording to the verifier's audio
 * key, so this server has only ciphertext. The verifier checks the input. The result is as for
 * `callVerifierWithAttestation`: an output of a known kind, unchanged, or a `VerifierCallError`.
 *
 * Check the input's `owner` before the call. Your payment key pays for each run, and it is the
 * authority for the enrollment of each owner, so relay only the inputs of the owner that the
 * caller proved to be.
 */
export async function relayToVerifier(
  config: VerifierConfig,
  input: Readonly<Record<string, unknown>>,
): Promise<VerifierCall<VerifierOutput>> {
  return await runVerifier(config, input);
}

const OUTPUT_KINDS: readonly string[] = [
  'seams_voice_verify_output_v2',
  'seams_voice_enrollment_v3',
  'seams_voice_transcript_output_v1',
  'seams_voice_intent_output_v1',
] satisfies readonly VerifierOutput['kind'][];

async function runVerifier(config: VerifierConfig, input: object): Promise<VerifierCall<VerifierOutput>> {
  if (!/^[a-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(config.project)) throw new RangeError('project must be owner/project');
  const base = new URL(config.baseUrl);
  if (base.protocol !== 'https:') throw new RangeError('baseUrl must be an HTTPS URL');
  const url = `${base.origin}${base.pathname.replace(/\/+$/, '')}/call/${config.project}`;
  let response: Response;
  try {
    response = await (config.fetch ?? fetch)(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Payment-Key': config.paymentKey,
        ...(config.computeLimit === undefined ? {} : { 'X-Compute-Limit': String(config.computeLimit) }),
      },
      body: JSON.stringify({
        input,
        async: false,
        ...(config.versionKey === undefined ? {} : { version_key: config.versionKey }),
        secrets_ref: config.secretsRef,
        resource_limits: config.resourceLimits ?? DEFAULT_LIMITS,
      }),
      signal: AbortSignal.timeout(config.timeoutMs ?? 60_000),
    });
  } catch (cause) {
    const timedOut = cause instanceof DOMException && cause.name === 'TimeoutError';
    throw new VerifierCallError(timedOut ? 'timeout' : 'network', timedOut ? 'the verifier did not answer in time' : 'the verifier is not reachable');
  }
  if (!response.ok) throw new VerifierCallError('http', `OutLayer refused the call (${response.status})`, response.status);
  let raw: unknown;
  try {
    raw = JSON.parse(await response.text());
  } catch {
    throw new VerifierCallError('output', 'the reply of OutLayer is not JSON');
  }
  const reply = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const completed = reply.error == null && (typeof reply.status !== 'string' || reply.status === 'completed');
  const output = reply.output;
  if (!completed || typeof output !== 'object' || output === null) {
    throw new VerifierCallError(
      'output',
      // A run that OutLayer stops at the compute limit fails with a trap and no reason.
      `the verifier run did not complete (status ${String(reply.status)}, ${String(reply.instructions)} instructions)`,
    );
  }
  const kind = (output as { kind?: unknown }).kind;
  if (typeof kind !== 'string' || !OUTPUT_KINDS.includes(kind)) {
    // An input without a known operation gives `seams_voice_error_v1`.
    throw new VerifierCallError('output', `the verifier gave the output kind ${String(kind)}`);
  }
  return {
    output: output as VerifierOutput,
    callId: typeof reply.call_id === 'string' ? reply.call_id : null,
    attestationUrl: typeof reply.attestation_url === 'string' ? reply.attestation_url : null,
    timeMs: typeof reply.time_ms === 'number' ? reply.time_ms : null,
    instructions: typeof reply.instructions === 'number' ? reply.instructions : null,
    computeCost: typeof reply.compute_cost === 'string' ? reply.compute_cost : null,
  };
}
