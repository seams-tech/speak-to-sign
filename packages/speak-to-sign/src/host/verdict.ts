import { base64UrlEncode, isPlainObject } from '@seams/wallet/voiceid-host';
import {
  concat,
  RENDERER_VERSION,
  renderTransfer,
  requestDigest,
  sha256,
  spokenTextDigest,
  utf8,
  type VaultTransferRequest,
} from './intent';

const VERDICT_KIND = 'seams_voice_signed_verdict_v1';
const VERDICT_DOMAIN = 'seams:outlayer:voice-verdict:v1';
const VERIFIER_REFUSALS = [
  'quality',
  'speaker',
  'words',
  'audio_reused',
  'audio_invalid',
  'template_missing',
  'unsupported',
  'speaker_unavailable',
  'storage',
  'transcriber_unavailable',
] as const;
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

export type VerifierRefusal = (typeof VERIFIER_REFUSALS)[number];

/** The verifier output that the Seams verify route passes through unchanged. */
export type VerifyOutput = Readonly<{
  verdictJson: string;
  signatureB64: string | null;
  publicKey: string | null;
  ms: Readonly<Record<string, unknown>>;
}>;

export type VerdictCheck =
  | Readonly<{ kind: 'accepted'; verdictJson: string; signatureB64: string }>
  | Readonly<{ kind: 'refused'; reason: VerifierRefusal; detail?: string }>
  | Readonly<{ kind: 'mismatch'; detail: string }>;

export function parseVerifyOutput(value: unknown): VerifyOutput | null {
  if (!isPlainObject(value) || typeof value.verdict_json !== 'string') return null;
  return {
    verdictJson: value.verdict_json,
    signatureB64: typeof value.signature_b64 === 'string' ? value.signature_b64 : null,
    publicKey: typeof value.public_key === 'string' ? value.public_key : null,
    ms: isPlainObject(value.ms) ? value.ms : {},
  };
}

/**
 * Checks a verdict before the Wallet pays for gas: the kind and renderer, the outcome, the
 * request, spoken text and audio digests, the vault's pinned verifier key and the signature.
 * The vault checks the same fields again.
 */
export async function checkVerdict(input: {
  readonly output: VerifyOutput;
  readonly request: VaultTransferRequest;
  /** SHA-256 of the WAV that the Wallet sent. */
  readonly audioDigest: Uint8Array;
  readonly pinnedVerifierKey: string;
}): Promise<VerdictCheck> {
  let verdict: unknown;
  try {
    verdict = JSON.parse(input.output.verdictJson);
  } catch {
    return { kind: 'mismatch', detail: 'verdict is not JSON' };
  }
  if (!isPlainObject(verdict) || verdict.kind !== VERDICT_KIND) {
    return { kind: 'mismatch', detail: 'unknown verdict kind' };
  }
  if (verdict.renderer !== RENDERER_VERSION) {
    return { kind: 'mismatch', detail: 'unknown renderer' };
  }
  if (verdict.outcome !== 'accept') {
    const reason = VERIFIER_REFUSALS.find((candidate) => candidate === verdict.reason);
    return reason
      ? { kind: 'refused', reason, ...heardDetail(verdict.heard) }
      : { kind: 'mismatch', detail: 'unknown refusal' };
  }
  const expected = {
    request_digest: base64UrlEncode(await requestDigest(input.request)),
    spoken_text_digest: base64UrlEncode(await spokenTextDigest(renderTransfer(input.request))),
    audio_digest: base64UrlEncode(input.audioDigest),
  };
  for (const [field, digest] of Object.entries(expected)) {
    if (verdict[field] !== digest) return { kind: 'mismatch', detail: `${field} differs` };
  }
  const { signatureB64, publicKey } = input.output;
  if (!signatureB64 || publicKey !== input.pinnedVerifierKey) {
    return { kind: 'mismatch', detail: 'verdict key is not the vault verifier key' };
  }
  const message = await sha256(concat([utf8(VERDICT_DOMAIN), utf8(input.output.verdictJson)]));
  if (!(await verifyEd25519(publicKey, signatureB64, message))) {
    return { kind: 'mismatch', detail: 'verdict signature is invalid' };
  }
  return { kind: 'accepted', verdictJson: input.output.verdictJson, signatureB64 };
}

function heardDetail(heard: unknown): { detail?: string } {
  return typeof heard === 'string' && heard ? { detail: `heard: ${heard}` } : {};
}

async function verifyEd25519(
  publicKey: string,
  signatureB64: string,
  message: Uint8Array<ArrayBuffer>,
): Promise<boolean> {
  const keyBytes = publicKey.startsWith('ed25519:') ? base58(publicKey.slice(8)) : null;
  const signature = base64(signatureB64);
  if (!keyBytes || keyBytes.length !== 32 || !signature || signature.length !== 64) return false;
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'Ed25519' }, false, [
    'verify',
  ]);
  return await crypto.subtle.verify({ name: 'Ed25519' }, key, signature, message);
}

function base58(text: string): Uint8Array<ArrayBuffer> | null {
  let value = 0n;
  for (const char of text) {
    const digit = B58.indexOf(char);
    if (digit < 0) return null;
    value = value * 58n + BigInt(digit);
  }
  const bytes: number[] = [];
  for (; value > 0n; value >>= 8n) bytes.unshift(Number(value & 0xffn));
  const zeros = text.length - text.replace(/^1+/, '').length;
  return Uint8Array.from([...new Array<number>(zeros).fill(0), ...bytes]);
}

function base64(text: string): Uint8Array<ArrayBuffer> | null {
  try {
    return Uint8Array.from(atob(text), charCode);
  } catch {
    return null;
  }
}

export function base64Standard(bytes: Uint8Array): string {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

function charCode(char: string): number {
  return char.charCodeAt(0);
}
