/**
 * The request of an application that is not a NEAR application: `SpokenRequestV1::Confirmation`
 * (Borsh tag 10) of `spoken-intent`. It binds an owner that the application names, a context, the
 * SHA-256 of any payload, and the summary that the owner says.
 */
import { requestDigest } from './verdict.ts';

/** The Borsh tag of `SpokenRequestV1::Confirmation`. */
const CONFIRMATION_TAG = 10;

const utf8 = new TextEncoder();

export interface ConfirmationFields {
  /** `app:` and the id of the user: `a-z`, `0-9`, `.`, `_`, `-`, `:`. At most 100 bytes. */
  owner: string;
  /** The action, for example `shop.example/checkout`: 1 to 64 of `a-z`, `0-9`, `.`, `_`, `-`, `:`, `/`. */
  context: string;
  /** SHA-256 of the payload bytes: 32 bytes or 64 hex characters. Or give `payload`. */
  payloadSha256?: Uint8Array | string;
  /** The payload bytes. The function hashes them. */
  payload?: Uint8Array;
  /**
   * The sentence that the owner says: 1 to 12 words of ASCII letters. The verifier checks the
   * rules and refuses a summary that it cannot speak (`unsupported`).
   */
  summary: string;
}

export interface ConfirmationRequest {
  /** The owner, for the `owner` field of the verifier input. */
  owner: string;
  /** The `request` object of the verifier input (`verify`), or one entry of `requests` (`select`). */
  request: { kind: 'confirmation'; context: string; payload_sha256_hex: string; summary: string };
  /** The Borsh bytes of the request. */
  borsh: Uint8Array<ArrayBuffer>;
  /** The request digest. Pass it to `checkVerdict` as `requestDigest`. */
  digest: Uint8Array<ArrayBuffer>;
}

/**
 * Builds a confirmation request and its digest. It throws a `RangeError` for an owner, a context
 * or a payload digest that the verifier refuses.
 */
export async function confirmationRequest(fields: ConfirmationFields): Promise<ConfirmationRequest> {
  const { owner, context, summary } = fields;
  if (!/^app:[a-z0-9._:-]+$/.test(owner) || owner.length > 100) {
    throw new RangeError('owner must be app:<id>, with an id of a-z, 0-9, ".", "_", "-" and ":"');
  }
  if (!/^[a-z0-9._:/-]{1,64}$/.test(context)) {
    throw new RangeError('context must be 1 to 64 characters of a-z, 0-9, ".", "_", "-", ":" and "/"');
  }
  const payloadSha256 = await payloadDigest(fields);
  const borsh = concat([
    Uint8Array.of(CONFIRMATION_TAG),
    borshString(owner),
    borshString(context),
    payloadSha256,
    borshString(summary),
  ]);
  return {
    owner,
    request: { kind: 'confirmation', context, payload_sha256_hex: toHex(payloadSha256), summary },
    borsh,
    digest: await requestDigest(borsh),
  };
}

async function payloadDigest(fields: ConfirmationFields): Promise<Uint8Array> {
  if ((fields.payload === undefined) === (fields.payloadSha256 === undefined)) {
    throw new RangeError('give payload or payloadSha256, and not both');
  }
  if (fields.payload !== undefined) {
    return new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(fields.payload)));
  }
  const digest = fields.payloadSha256!;
  if (typeof digest !== 'string') {
    if (digest.length !== 32) throw new RangeError('payloadSha256 must be 32 bytes');
    return digest;
  }
  if (!/^[0-9a-f]{64}$/.test(digest)) throw new RangeError('payloadSha256 must be 64 lowercase hex characters');
  return Uint8Array.from(digest.match(/../g)!, (byte) => Number.parseInt(byte, 16));
}

/** A Borsh string: the byte length as `u32` little-endian, then the UTF-8 bytes. */
function borshString(text: string): Uint8Array {
  const bytes = utf8.encode(text);
  const out = new Uint8Array(4 + bytes.length);
  new DataView(out.buffer).setUint32(0, bytes.length, true);
  out.set(bytes, 4);
  return out;
}

function concat(parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}
