/**
 * The check of a signed Speak-to-Sign verdict (`seams_voice_signed_verdict_v2`).
 *
 * The verifier signs `SHA-256(VERDICT_DOMAIN || verdict JSON bytes)` with ed25519. This module
 * checks the signature over the exact text that it receives, then reads the 13 fields. It has no
 * dependency: it uses the Web Crypto API (`crypto.subtle`) of the browser, Node.js 20 or later,
 * Deno, Bun and Cloudflare Workers.
 */

/** The prefix of the signed message. */
export const VERDICT_DOMAIN = 'seams:outlayer:voice-verdict:v2';
/** The only verdict kind that this module accepts. */
export const VERDICT_KIND = 'seams_voice_signed_verdict_v2';
/** The prefix of the request digest preimage of `spoken-intent`. */
export const REQUEST_DIGEST_DOMAIN = 'seams:spoken-intent:request:v1';

/** The renderer version of `spoken-intent`. A verdict of another renderer does not pass. */
export const RENDERER_VERSION = 'spoken-intent/1';

/** The verifier signs a verdict with `expires_at_ms` 120 s after its own clock. */
export const VERDICT_LIFE_MS = 120_000;

/** A later expiry than this, from the time of the check, means a verifier clock that runs ahead. */
export const MAX_VERDICT_LIFE_MS = VERDICT_LIFE_MS + 30_000;

export type VerdictOutcome = 'accept' | 'step_up' | 'refuse';

/** The 13 signed fields. A digest is `null` only on a refusal that came before it was known. */
export interface VoiceVerdict {
  kind: typeof VERDICT_KIND;
  /** The renderer version, for example `spoken-intent/1`. */
  renderer: string;
  /** The verifier version. The worker writes it; nothing proves it. */
  verifier: string;
  /** base64url, no padding. */
  request_digest: string | null;
  /** base64url, no padding. */
  spoken_text_digest: string | null;
  /** base64url, no padding: SHA-256 of the canonical WAV. */
  audio_digest: string | null;
  outcome: VerdictOutcome;
  /** Set only on `refuse`. A later verifier version can add a reason. */
  reason: string | null;
  /** The id of the policy rule, set only on `step_up`. */
  policy_rule: string | null;
  /** ms since the UNIX epoch. */
  expires_at_ms: number;
  speaker_score_milli: number | null;
  word_margin_milli: number | null;
  /** The heard words, for display only. Verifier 0.15.0 and later sets them only on a `words` refusal. No check reads it. */
  heard: string | null;
}

/** Why a verdict does not pass. */
export type VerdictRefusal =
  /** The public key is not 32 bytes in a known form. */
  | { code: 'bad_public_key' }
  /** `signatureB64` is not standard base64 of 64 bytes. */
  | { code: 'bad_signature_encoding' }
  /** The key did not sign these bytes. */
  | { code: 'bad_signature' }
  /** The signed text is not a verdict of 13 fields. */
  | { code: 'malformed'; detail: string }
  /** The signed `kind` is not `seams_voice_signed_verdict_v2`. */
  | { code: 'wrong_kind'; kind: string }
  /** The signed `renderer` is not `RENDERER_VERSION`. */
  | { code: 'wrong_renderer'; renderer: string }
  /** The verifier refused. `reason` is the verifier's reason. */
  | { code: 'refused'; reason: string | null; verdict: VoiceVerdict }
  /** The voice and the words passed, and a policy rule asks for a second approval. */
  | { code: 'step_up'; policyRule: string | null; verdict: VoiceVerdict }
  /** `expires_at_ms` is not after `nowMs`. */
  | { code: 'expired'; expiresAtMs: number; verdict: VoiceVerdict }
  /** `expires_at_ms` is more than `MAX_VERDICT_LIFE_MS` after `nowMs`. */
  | { code: 'not_yet_valid'; expiresAtMs: number; verdict: VoiceVerdict }
  /** The verdict is for another request. */
  | { code: 'request_mismatch'; verdict: VoiceVerdict }
  /** The verdict is for another spoken sentence. */
  | { code: 'spoken_text_mismatch'; verdict: VoiceVerdict }
  /** The verdict is for another recording. */
  | { code: 'audio_mismatch'; verdict: VoiceVerdict };

export type VerdictCheck =
  | { ok: true; verdict: VoiceVerdict }
  | { ok: false; refusal: VerdictRefusal };

/** A 32-byte digest: the bytes, 64 hex characters, or base64url text with no padding. */
export type Digest = Uint8Array | string;

export interface CheckVerdictInput {
  /** The signed text, exactly as the verifier gave it. Do not parse and serialize it again. */
  verdictJson: string;
  /** Standard base64 of the 64-byte signature (`signature_b64` of the verify output). */
  signatureB64: string;
  /**
   * The verifier key that you pin: `ed25519:<base58>`, 64 hex characters, or 32 bytes. Do not
   * take it from the verify output that you check.
   */
  publicKey: string | Uint8Array;
  /** The digest of the request that you built yourself. Without it, any request passes. */
  requestDigest?: Digest;
  /**
   * The spoken-text digest of the request that you built yourself:
   * `SHA-256("seams:spoken-intent:spoken:v1" || spoken_text)`.
   */
  spokenTextDigest?: Digest;
  /** The digest of the recording that you sent. */
  audioDigest?: Digest;
  /** The time of the check, in ms since the UNIX epoch. Default: `Date.now()`. */
  nowMs?: number;
  /** `true` lets a `step_up` verdict pass. Then you must get the second approval yourself. */
  acceptStepUp?: boolean;
}

const VERDICT_FIELDS = [
  'kind',
  'renderer',
  'verifier',
  'request_digest',
  'spoken_text_digest',
  'audio_digest',
  'outcome',
  'reason',
  'policy_rule',
  'expires_at_ms',
  'speaker_score_milli',
  'word_margin_milli',
  'heard',
] as const;

const utf8 = new TextEncoder();

/**
 * Checks a signed verdict. The checks run in this order: key, signature, shape, kind, renderer,
 * outcome, expiry, request digest, spoken-text digest, audio digest. It does not throw for a bad
 * verdict.
 */
export async function checkVerdict(input: CheckVerdictInput): Promise<VerdictCheck> {
  const key = parsePublicKey(input.publicKey);
  if (key === null) return refuse({ code: 'bad_public_key' });
  const signature = fromBase64(input.signatureB64);
  if (signature === null || signature.length !== 64) return refuse({ code: 'bad_signature_encoding' });
  const message = await verdictMessage(input.verdictJson);
  if (!(await verifyEd25519(key, signature, message))) return refuse({ code: 'bad_signature' });

  const parsed = parseVerdict(input.verdictJson);
  if ('refusal' in parsed) return refuse(parsed.refusal);
  const verdict = parsed.verdict;

  if (verdict.outcome === 'refuse') return refuse({ code: 'refused', reason: verdict.reason, verdict });
  if (verdict.outcome === 'step_up' && input.acceptStepUp !== true) {
    return refuse({ code: 'step_up', policyRule: verdict.policy_rule, verdict });
  }
  const nowMs = input.nowMs ?? Date.now();
  if (verdict.expires_at_ms <= nowMs) {
    return refuse({ code: 'expired', expiresAtMs: verdict.expires_at_ms, verdict });
  }
  if (verdict.expires_at_ms > nowMs + MAX_VERDICT_LIFE_MS) {
    return refuse({ code: 'not_yet_valid', expiresAtMs: verdict.expires_at_ms, verdict });
  }
  if (input.requestDigest !== undefined && !sameDigest(verdict.request_digest, input.requestDigest)) {
    return refuse({ code: 'request_mismatch', verdict });
  }
  if (input.spokenTextDigest !== undefined && !sameDigest(verdict.spoken_text_digest, input.spokenTextDigest)) {
    return refuse({ code: 'spoken_text_mismatch', verdict });
  }
  if (input.audioDigest !== undefined && !sameDigest(verdict.audio_digest, input.audioDigest)) {
    return refuse({ code: 'audio_mismatch', verdict });
  }
  return { ok: true, verdict };
}

/** `SHA-256(VERDICT_DOMAIN || verdict JSON bytes)`: the 32 bytes that the verifier key signs. */
export function verdictMessage(verdictJson: string): Promise<Uint8Array<ArrayBuffer>> {
  return sha256(concat(utf8.encode(VERDICT_DOMAIN), utf8.encode(verdictJson)));
}

/**
 * `SHA-256(REQUEST_DIGEST_DOMAIN || borsh(request))`: the request digest of `spoken-intent`.
 * `requestBorsh` is the Borsh of a `SpokenRequestV1`.
 *
 * It rejects tag 1 (a multisig approval). The digest of that kind binds the salted commitment
 * and not the proposal (`spoken_intent::multisig_approval_digest`), so it is not the digest of
 * these bytes.
 */
export async function requestDigest(requestBorsh: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
  if (requestBorsh.length === 0) throw new RangeError('the request has no bytes');
  if (requestBorsh[0] === 1) throw new RangeError('a multisig approval (tag 1) has its own digest');
  return sha256(concat(utf8.encode(REQUEST_DIGEST_DOMAIN), requestBorsh));
}

/**
 * Reads the 13 fields of a verdict text. It does not check the signature: use `checkVerdict`
 * for a verdict that you did not make.
 */
export function parseVerdict(verdictJson: string): { verdict: VoiceVerdict } | { refusal: VerdictRefusal } {
  let value: unknown;
  try {
    value = JSON.parse(verdictJson);
  } catch {
    return malformed('not JSON');
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return malformed('not an object');
  const record = value as Record<string, unknown>;
  const names = Object.keys(record);
  for (const name of VERDICT_FIELDS) {
    if (!Object.hasOwn(record, name)) return malformed(`no field ${name}`);
  }
  if (names.length !== VERDICT_FIELDS.length) return malformed('unknown field');

  if (typeof record.kind !== 'string') return malformed('kind');
  if (record.kind !== VERDICT_KIND) return { refusal: { code: 'wrong_kind', kind: record.kind } };
  for (const name of ['renderer', 'verifier'] as const) {
    if (typeof record[name] !== 'string') return malformed(name);
  }
  if (record.renderer !== RENDERER_VERSION) return { refusal: { code: 'wrong_renderer', renderer: record.renderer as string } };
  for (const name of ['request_digest', 'spoken_text_digest', 'audio_digest'] as const) {
    const text = record[name];
    if (text !== null && (typeof text !== 'string' || fromBase64Url(text)?.length !== 32)) return malformed(name);
  }
  if (record.outcome !== 'accept' && record.outcome !== 'step_up' && record.outcome !== 'refuse') {
    return malformed('outcome');
  }
  for (const name of ['reason', 'policy_rule', 'heard'] as const) {
    if (record[name] !== null && typeof record[name] !== 'string') return malformed(name);
  }
  const expires = record.expires_at_ms;
  if (typeof expires !== 'number' || !Number.isSafeInteger(expires) || expires < 0) return malformed('expires_at_ms');
  for (const name of ['speaker_score_milli', 'word_margin_milli'] as const) {
    if (record[name] !== null && !Number.isSafeInteger(record[name])) return malformed(name);
  }
  // An approval names its request, its sentence and its recording, and gives no refusal reason.
  // Only a step-up names the rule that asked for the second approval.
  if (record.outcome !== 'refuse') {
    if (record.request_digest === null || record.spoken_text_digest === null || record.audio_digest === null) {
      return malformed('an approval with no digest');
    }
    if (record.reason !== null) return malformed('an approval with a reason');
    const rule = record.policy_rule;
    if (record.outcome === 'accept' ? rule !== null : typeof rule !== 'string' || rule === '') {
      return malformed('policy_rule');
    }
  }
  return { verdict: record as unknown as VoiceVerdict };
}

/** Reads `ed25519:<base58>`, 64 hex characters or 32 bytes. `null` for any other value. */
export function parsePublicKey(key: string | Uint8Array): Uint8Array<ArrayBuffer> | null {
  if (typeof key !== 'string') return key.length === 32 ? new Uint8Array(key) : null;
  const bytes = key.startsWith('ed25519:') ? fromBase58(key.slice('ed25519:'.length)) : fromHex(key);
  return bytes !== null && bytes.length === 32 ? bytes : null;
}

function refuse(refusal: VerdictRefusal): VerdictCheck {
  return { ok: false, refusal };
}

function malformed(detail: string): { refusal: VerdictRefusal } {
  return { refusal: { code: 'malformed', detail } };
}

async function verifyEd25519(
  key: Uint8Array<ArrayBuffer>,
  signature: Uint8Array<ArrayBuffer>,
  message: Uint8Array<ArrayBuffer>,
): Promise<boolean> {
  try {
    const imported = await crypto.subtle.importKey('raw', key, { name: 'Ed25519' }, false, ['verify']);
    return await crypto.subtle.verify({ name: 'Ed25519' }, imported, signature, message);
  } catch (cause) {
    // A key that is not a point of the curve is a bad signature. A runtime with no Ed25519 is
    // an error of the environment, and the caller must know about it.
    if (cause instanceof Error && cause.name === 'NotSupportedError') throw cause;
    return false;
  }
}

async function sha256(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
}

function concat(first: Uint8Array, second: Uint8Array): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(first.length + second.length);
  bytes.set(first, 0);
  bytes.set(second, first.length);
  return bytes;
}

/** `true` if the verdict's base64url digest is the expected digest. */
function sameDigest(signed: string | null, expected: Digest): boolean {
  if (signed === null) return false;
  const want = digestBytes(expected);
  const have = fromBase64Url(signed);
  if (want === null || have === null || have.length !== 32) return false;
  return have.every((byte, index) => byte === want[index]);
}

function digestBytes(digest: Digest): Uint8Array | null {
  if (typeof digest !== 'string') return digest.length === 32 ? digest : null;
  const bytes = digest.length === 64 ? fromHex(digest) : fromBase64Url(digest);
  return bytes !== null && bytes.length === 32 ? bytes : null;
}

function fromHex(text: string): Uint8Array<ArrayBuffer> | null {
  if (text.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(text)) return null;
  const bytes = new Uint8Array(text.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(text.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

/** Standard base64 with padding. */
function fromBase64(text: string): Uint8Array<ArrayBuffer> | null {
  if (text.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(text)) return null;
  try {
    const binary = atob(text);
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
}

/** base64url with no padding. */
function fromBase64Url(text: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text) || text.length % 4 === 1) return null;
  const standard = text.replaceAll('-', '+').replaceAll('_', '/');
  return fromBase64(standard + '='.repeat((4 - (standard.length % 4)) % 4));
}

const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function fromBase58(text: string): Uint8Array<ArrayBuffer> | null {
  let value = 0n;
  for (const char of text) {
    const digit = BASE58.indexOf(char);
    if (digit < 0) return null;
    value = value * 58n + BigInt(digit);
  }
  const bytes: number[] = [];
  while (value > 0n) {
    bytes.unshift(Number(value & 0xffn));
    value >>= 8n;
  }
  for (const char of text) {
    if (char !== '1') break;
    bytes.unshift(0);
  }
  return Uint8Array.from(bytes);
}

// ---------------------------------------------------------------------------------------------
// Signed transcripts (the operation `transcribe`).

/** The prefix of the signed message of a transcript. It is not the prefix of a verdict. */
export const TRANSCRIPT_DOMAIN = 'seams:outlayer:voice-transcript:v1';
/** The kind of a signed transcript. */
export const TRANSCRIPT_KIND = 'seams_voice_signed_transcript_v1';

/**
 * The 9 signed fields of a transcript. A transcript says: the voice of `owner` passed the speaker
 * check on this audio, and the speech-to-text model heard `text`. It approves no request.
 */
export interface VoiceTranscript {
  kind: typeof TRANSCRIPT_KIND;
  verifier: string;
  owner: string | null;
  /** base64url, no padding: SHA-256 of the canonical WAV. */
  audio_digest: string | null;
  outcome: 'accept' | 'refuse';
  reason: string | null;
  expires_at_ms: number;
  speaker_score_milli: number | null;
  /** Lowercase words, digits and apostrophes. Set only on `accept`. */
  text: string | null;
}

export type TranscriptRefusal =
  | { code: 'bad_public_key' }
  | { code: 'bad_signature_encoding' }
  | { code: 'bad_signature' }
  | { code: 'malformed'; detail: string }
  | { code: 'wrong_kind'; kind: string }
  /** The verifier refused, for example with the reason `speaker`. */
  | { code: 'refused'; reason: string | null; transcript: VoiceTranscript }
  | { code: 'expired'; expiresAtMs: number; transcript: VoiceTranscript }
  /** The transcript is of another owner. */
  | { code: 'owner_mismatch'; transcript: VoiceTranscript }
  | { code: 'audio_mismatch'; transcript: VoiceTranscript };

export type TranscriptCheck =
  | { ok: true; transcript: VoiceTranscript & { owner: string; text: string } }
  | { ok: false; refusal: TranscriptRefusal };

export interface CheckTranscriptInput {
  /** `transcript_json` of the transcribe output, exactly as the verifier gave it. */
  transcriptJson: string;
  signatureB64: string;
  /** The verifier key that you pin. */
  publicKey: string | Uint8Array;
  /** The owner that you asked for. Without it, a transcript of any owner passes. */
  owner?: string;
  audioDigest?: Digest;
  /** Default: `Date.now()`. */
  nowMs?: number;
}

const TRANSCRIPT_FIELDS = [
  'kind',
  'verifier',
  'owner',
  'audio_digest',
  'outcome',
  'reason',
  'expires_at_ms',
  'speaker_score_milli',
  'text',
] as const;

/**
 * Checks a signed transcript: key, signature, shape, kind, outcome, expiry, owner, audio digest.
 *
 * A transcript is weaker than a verdict. The verifier expected no sentence, so it made no word
 * check: a wrong word of the speech-to-text model is a wrong word of `text`. Do not let a
 * transcript approve an action with value. Use `verify` or `select` for that.
 */
export async function checkTranscript(input: CheckTranscriptInput): Promise<TranscriptCheck> {
  const refuse = (refusal: TranscriptRefusal): TranscriptCheck => ({ ok: false, refusal });
  const key = parsePublicKey(input.publicKey);
  if (key === null) return refuse({ code: 'bad_public_key' });
  const signature = fromBase64(input.signatureB64);
  if (signature === null || signature.length !== 64) return refuse({ code: 'bad_signature_encoding' });
  const message = await sha256(concat(utf8.encode(TRANSCRIPT_DOMAIN), utf8.encode(input.transcriptJson)));
  if (!(await verifyEd25519(key, signature, message))) return refuse({ code: 'bad_signature' });

  let value: unknown;
  try {
    value = JSON.parse(input.transcriptJson);
  } catch {
    return refuse({ code: 'malformed', detail: 'not JSON' });
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return refuse({ code: 'malformed', detail: 'not an object' });
  const record = value as Record<string, unknown>;
  const bad = (detail: string) => refuse({ code: 'malformed', detail });
  for (const name of TRANSCRIPT_FIELDS) if (!Object.hasOwn(record, name)) return bad(`no field ${name}`);
  if (Object.keys(record).length !== TRANSCRIPT_FIELDS.length) return bad('unknown field');
  if (typeof record.kind !== 'string') return bad('kind');
  if (record.kind !== TRANSCRIPT_KIND) return refuse({ code: 'wrong_kind', kind: record.kind });
  if (typeof record.verifier !== 'string') return bad('verifier');
  for (const name of ['owner', 'reason', 'text'] as const) {
    if (record[name] !== null && typeof record[name] !== 'string') return bad(name);
  }
  const digest = record.audio_digest;
  if (digest !== null && (typeof digest !== 'string' || fromBase64Url(digest)?.length !== 32)) return bad('audio_digest');
  if (record.outcome !== 'accept' && record.outcome !== 'refuse') return bad('outcome');
  const expires = record.expires_at_ms;
  if (typeof expires !== 'number' || !Number.isSafeInteger(expires) || expires < 0) return bad('expires_at_ms');
  if (record.speaker_score_milli !== null && !Number.isSafeInteger(record.speaker_score_milli)) return bad('speaker_score_milli');
  const transcript = record as unknown as VoiceTranscript;

  if (transcript.outcome === 'refuse') return refuse({ code: 'refused', reason: transcript.reason, transcript });
  if (transcript.owner === null || transcript.text === null) return bad('an accept with no owner or no text');
  if (transcript.expires_at_ms < (input.nowMs ?? Date.now())) {
    return refuse({ code: 'expired', expiresAtMs: transcript.expires_at_ms, transcript });
  }
  if (input.owner !== undefined && transcript.owner !== input.owner) return refuse({ code: 'owner_mismatch', transcript });
  if (input.audioDigest !== undefined && !sameDigest(transcript.audio_digest, input.audioDigest)) {
    return refuse({ code: 'audio_mismatch', transcript });
  }
  return { ok: true, transcript: transcript as VoiceTranscript & { owner: string; text: string } };
}

// ---------------------------------------------------------------------------------------------
// Signed intent results (the operation `detect`).

/** The prefix of the signed message of an intent result. */
export const INTENT_DOMAIN = 'seams:outlayer:voice-intent:v1';
/** The kind of a signed intent result. */
export const INTENT_KIND = 'seams_voice_signed_intent_v1';
/** The prefix of the digest of an intent list. */
export const INTENTS_DIGEST_DOMAIN = 'seams:voice-intent:intents:v1';

/** One intent that your application offers to `detect`. */
export interface IntentSpec {
  /** 1 to 32 characters of `a-z`, `0-9` and `_`. */
  name: string;
  /** What the intent means, for the model: 1 to 120 ASCII letters, digits, spaces and `. , ' -`. */
  description: string;
  /** At most 6 slots: the name (as an intent name) and the kind of its value. */
  slots?: Record<string, 'text' | 'number'>;
}

/**
 * The 13 signed fields of a `detect` result: the voice of `owner` passed the speaker check, the
 * speech-to-text model heard `text`, and a chat model named `intent` of your list for those
 * words. It is a proposal. It approves no request.
 */
export interface VoiceIntent {
  kind: typeof INTENT_KIND;
  verifier: string;
  owner: string | null;
  /** base64url, no padding. */
  audio_digest: string | null;
  /** base64url, no padding: the digest of the intent list that the model saw. */
  intents_digest: string | null;
  outcome: 'accept' | 'refuse';
  reason: string | null;
  expires_at_ms: number;
  speaker_score_milli: number | null;
  text: string | null;
  /** The chat model that named the intent. */
  model: string | null;
  /** The name of one intent of the list, or `null` if the model named none. */
  intent: string | null;
  /** A value or `null` for each slot of the intent. `null` with no intent. */
  slots: Record<string, string | number | null> | null;
}

export type IntentRefusal =
  | { code: 'bad_public_key' }
  | { code: 'bad_signature_encoding' }
  | { code: 'bad_signature' }
  | { code: 'malformed'; detail: string }
  | { code: 'wrong_kind'; kind: string }
  /** The verifier refused, for example with `speaker` or `detector_unavailable`. */
  | { code: 'refused'; reason: string | null; result: VoiceIntent }
  | { code: 'expired'; expiresAtMs: number; result: VoiceIntent }
  | { code: 'owner_mismatch'; result: VoiceIntent }
  | { code: 'audio_mismatch'; result: VoiceIntent }
  /** The result is for another intent list than yours, or names an intent or a slot that is not in it. */
  | { code: 'intents_mismatch'; result: VoiceIntent };

export type IntentCheck =
  | { ok: true; result: VoiceIntent & { owner: string; text: string } }
  | { ok: false; refusal: IntentRefusal };

export interface CheckIntentInput {
  /** `intent_json` of the detect output, exactly as the verifier gave it. */
  intentJson: string;
  signatureB64: string;
  /** The verifier key that you pin. */
  publicKey: string | Uint8Array;
  /** The intent list that you sent. Without it, a result for any list passes. */
  intents?: readonly IntentSpec[];
  /** The owner that you asked for. */
  owner?: string;
  audioDigest?: Digest;
  /** Default: `Date.now()`. */
  nowMs?: number;
}

/**
 * The canonical JSON of an intent list, as the verifier writes it: each intent as `name`,
 * `description`, `slots`, and the slots in name order. The name and description rules of the
 * verifier keep it free of escapes.
 */
export function intentsJson(intents: readonly IntentSpec[]): string {
  return JSON.stringify(
    intents.map(({ name, description, slots }) => ({
      name,
      description,
      slots: Object.fromEntries(Object.entries(slots ?? {}).sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))),
    })),
  );
}

/** `SHA-256(INTENTS_DIGEST_DOMAIN || intentsJson)`: the `intents_digest` of a result. */
export function intentsDigest(intents: readonly IntentSpec[]): Promise<Uint8Array<ArrayBuffer>> {
  return sha256(concat(utf8.encode(INTENTS_DIGEST_DOMAIN), utf8.encode(intentsJson(intents))));
}

const INTENT_FIELDS = [
  'kind',
  'verifier',
  'owner',
  'audio_digest',
  'intents_digest',
  'outcome',
  'reason',
  'expires_at_ms',
  'speaker_score_milli',
  'text',
  'model',
  'intent',
  'slots',
] as const;

/**
 * Checks a signed result of `detect`: key, signature, shape, kind, outcome, expiry, owner, audio
 * digest, and that the intent and its slots are of your list.
 *
 * The result is a proposal. A speech-to-text model and a chat model made it, and neither signs
 * its part: a wrong word or a wrong intent is possible. Do not let it approve an action with
 * value. Show the proposed action, then confirm it with `verify` or `select`.
 */
export async function checkIntent(input: CheckIntentInput): Promise<IntentCheck> {
  const refuse = (refusal: IntentRefusal): IntentCheck => ({ ok: false, refusal });
  const key = parsePublicKey(input.publicKey);
  if (key === null) return refuse({ code: 'bad_public_key' });
  const signature = fromBase64(input.signatureB64);
  if (signature === null || signature.length !== 64) return refuse({ code: 'bad_signature_encoding' });
  const message = await sha256(concat(utf8.encode(INTENT_DOMAIN), utf8.encode(input.intentJson)));
  if (!(await verifyEd25519(key, signature, message))) return refuse({ code: 'bad_signature' });

  const bad = (detail: string) => refuse({ code: 'malformed', detail });
  let value: unknown;
  try {
    value = JSON.parse(input.intentJson);
  } catch {
    return bad('not JSON');
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return bad('not an object');
  const record = value as Record<string, unknown>;
  for (const name of INTENT_FIELDS) if (!Object.hasOwn(record, name)) return bad(`no field ${name}`);
  if (Object.keys(record).length !== INTENT_FIELDS.length) return bad('unknown field');
  if (typeof record.kind !== 'string') return bad('kind');
  if (record.kind !== INTENT_KIND) return refuse({ code: 'wrong_kind', kind: record.kind });
  if (typeof record.verifier !== 'string') return bad('verifier');
  for (const name of ['owner', 'reason', 'text', 'model', 'intent'] as const) {
    if (record[name] !== null && typeof record[name] !== 'string') return bad(name);
  }
  for (const name of ['audio_digest', 'intents_digest'] as const) {
    const digest = record[name];
    if (digest !== null && (typeof digest !== 'string' || fromBase64Url(digest)?.length !== 32)) return bad(name);
  }
  if (record.outcome !== 'accept' && record.outcome !== 'refuse') return bad('outcome');
  const expires = record.expires_at_ms;
  if (typeof expires !== 'number' || !Number.isSafeInteger(expires) || expires < 0) return bad('expires_at_ms');
  if (record.speaker_score_milli !== null && !Number.isSafeInteger(record.speaker_score_milli)) return bad('speaker_score_milli');
  const slots = record.slots;
  if (slots !== null) {
    if (typeof slots !== 'object' || Array.isArray(slots)) return bad('slots');
    const values = Object.values(slots as Record<string, unknown>);
    if (!values.every((item) => item === null || typeof item === 'string' || typeof item === 'number')) return bad('slots');
  }
  const result = record as unknown as VoiceIntent;

  if (result.outcome === 'refuse') return refuse({ code: 'refused', reason: result.reason, result });
  if (result.owner === null || result.text === null) return bad('an accept with no owner or no text');
  if ((result.intent === null) !== (result.slots === null)) return bad('an intent with no slots, or slots with no intent');
  if (result.expires_at_ms < (input.nowMs ?? Date.now())) {
    return refuse({ code: 'expired', expiresAtMs: result.expires_at_ms, result });
  }
  if (input.owner !== undefined && result.owner !== input.owner) return refuse({ code: 'owner_mismatch', result });
  if (input.audioDigest !== undefined && !sameDigest(result.audio_digest, input.audioDigest)) {
    return refuse({ code: 'audio_mismatch', result });
  }
  if (input.intents !== undefined) {
    if (!sameDigest(result.intents_digest, await intentsDigest(input.intents))) return refuse({ code: 'intents_mismatch', result });
    // The verifier checked this. Check it again: the list is yours.
    if (result.intent !== null) {
      const spec = input.intents.find((intent) => intent.name === result.intent);
      const known = spec !== undefined && Object.keys(result.slots ?? {}).every((slot) => Object.hasOwn(spec.slots ?? {}, slot));
      if (!known) return refuse({ code: 'intents_mismatch', result });
    }
  }
  return { ok: true, result: result as VoiceIntent & { owner: string; text: string } };
}
