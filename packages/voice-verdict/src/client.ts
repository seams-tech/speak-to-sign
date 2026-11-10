/**
 * A call of the Speak-to-Sign verifier, an OutLayer worker, over OutLayer's HTTPS API.
 *
 * Use it on a server. The payment key pays for the run, and it is the authority for the
 * enrollment of application owners (`app:<id>`), so it must not reach a browser.
 */

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
  /** Default: 20,000 ms. The `local-speaker` variant needs more: use 40,000. */
  timeoutMs?: number;
  /** Default: 10 billion instructions, 128 MB, 15 s. The `local-speaker` variant needs more. */
  resourceLimits?: { max_instructions: number; max_memory_mb: number; max_execution_seconds: number };
  /** Default: the global `fetch`. */
  fetch?: typeof fetch;
}

/** A request object of the verifier, by `kind`. `confirmationRequest` builds one. */
export type VerifierRequest = { kind: string } & Record<string, unknown>;

export type VerifierInput =
  | {
      op: 'enroll';
      owner: string;
      /** Exactly three 16 kHz mono PCM16 WAVs, standard base64. */
      audio_wav_b64: string[];
      /** Only for a NEAR owner: the NEP-413 authorization. */
      authorization?: { public_key: string; signature_b64: string; nonce_b64: string };
    }
  | { op: 'verify'; owner: string; request: VerifierRequest; contacts: string[]; audio_wav_b64: string }
  | { op: 'select'; owner: string; requests: VerifierRequest[]; contacts: string[]; audio_wav_b64: string };

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

const DEFAULT_LIMITS = { max_instructions: 10_000_000_000, max_memory_mb: 128, max_execution_seconds: 15 };

/** One call: the output, and where OutLayer serves the TDX attestation of the call. */
export interface VerifierCall<Output> {
  output: Output;
  callId: string | null;
  /** A path of the OutLayer API, for `fetchAttestation`. `null` if OutLayer gave none. */
  attestationUrl: string | null;
}

/** Runs one operation of the verifier and returns its output JSON. */
export async function callVerifier(config: VerifierConfig, input: Extract<VerifierInput, { op: 'enroll' }>): Promise<EnrollOutput>;
export async function callVerifier(
  config: VerifierConfig,
  input: Extract<VerifierInput, { op: 'verify' | 'select' }>,
): Promise<VerifyOutput>;
export async function callVerifier(config: VerifierConfig, input: VerifierInput): Promise<EnrollOutput | VerifyOutput> {
  return (await callVerifierWithAttestation(config, input as Extract<VerifierInput, { op: 'enroll' }>)).output;
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
  input: VerifierInput,
): Promise<VerifierCall<EnrollOutput | VerifyOutput>> {
  if (!/^[a-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(config.project)) throw new RangeError('project must be owner/project');
  const base = new URL(config.baseUrl);
  if (base.protocol !== 'https:') throw new RangeError('baseUrl must be an HTTPS URL');
  const url = `${base.origin}${base.pathname.replace(/\/+$/, '')}/call/${config.project}`;
  let response: Response;
  try {
    response = await (config.fetch ?? fetch)(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Payment-Key': config.paymentKey },
      body: JSON.stringify({
        input,
        async: false,
        ...(config.versionKey === undefined ? {} : { version_key: config.versionKey }),
        secrets_ref: config.secretsRef,
        resource_limits: config.resourceLimits ?? DEFAULT_LIMITS,
      }),
      signal: AbortSignal.timeout(config.timeoutMs ?? 20_000),
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
    throw new VerifierCallError('output', 'the verifier run did not complete');
  }
  const kind = (output as { kind?: unknown }).kind;
  if (kind !== 'seams_voice_verify_output_v2' && kind !== 'seams_voice_enrollment_v3') {
    // An input without a known operation gives `seams_voice_error_v1`.
    throw new VerifierCallError('output', `the verifier gave the output kind ${String(kind)}`);
  }
  return {
    output: output as EnrollOutput | VerifyOutput,
    callId: typeof reply.call_id === 'string' ? reply.call_id : null,
    attestationUrl: typeof reply.attestation_url === 'string' ? reply.attestation_url : null,
  };
}
