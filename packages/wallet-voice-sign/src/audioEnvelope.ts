// Sealed audio for a confidential spoken request. A recording is sealed to the verifier's audio
// key before it leaves the device, so the Seams server and OutLayer's coordinator carry only
// ciphertext. The verifier opens it inside its TEE (crates/voice-verifier/src/envelope.rs).
//
// The envelope is HPKE base mode (RFC 9180) with DHKEM(X25519, HKDF-SHA256), HKDF-SHA256 and
// AES-256-GCM, on WebCrypto alone. A sealed clip is `enc || ciphertext || tag`. The `aad` is
// `op || 0x00 || owner`, so a sealed clip opens only for that owner and that operation.
//
// This file imports nothing, so that an app can use it without the rest of the package.

type Bytes = Uint8Array<ArrayBuffer>;

/** The length of the audio key, of the encapsulated key and of each X25519 key. */
export const AUDIO_KEY_BYTES = 32;

const INFO = ascii('seams:voice-audio:v1');
const AUDIO_KEY_DOMAIN = ascii('seams:outlayer:voice-audio-key:v1');
const AUDIO_KEY_OUTPUT_KIND = 'seams_voice_audio_key_v1';

// RFC 9180, section 7: DHKEM(X25519, HKDF-SHA256) 0x0020, HKDF-SHA256 0x0001, AES-256-GCM 0x0002.
const KEM_SUITE = concat(ascii('KEM'), bytes(0x00, 0x20));
const HPKE_SUITE = concat(ascii('HPKE'), bytes(0x00, 0x20, 0x00, 0x01, 0x00, 0x02));
const VERSION = ascii('HPKE-v1');
const EMPTY = bytes();
const HASH_BYTES = 32;
const AEAD_KEY_BYTES = 32;
const AEAD_NONCE_BYTES = 12;
/** The PKCS#8 bytes before a raw X25519 private key (RFC 8410). */
const X25519_PKCS8_PREFIX = bytes(
  0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x6e, 0x04, 0x22, 0x04, 0x20,
);
/** The X25519 base point, u = 9. */
const X25519_BASE_POINT = (() => {
  const point = new Uint8Array(AUDIO_KEY_BYTES);
  point[0] = 9;
  return point;
})();

/** The operation that a sealed clip opens for. */
export type SealedAudioOp = 'verify' | 'enroll' | 'select' | 'transcribe' | 'detect';

/**
 * Seals one WAV to the verifier's audio key, for one operation of one owner. Each call uses a new
 * ephemeral key. The result is the verifier's `audio_sealed_b64` before base64.
 */
export async function sealAudio(
  audioKey: Uint8Array,
  op: SealedAudioOp,
  owner: string,
  wav: Uint8Array,
): Promise<Bytes> {
  const pair = (await crypto.subtle.generateKey({ name: 'X25519' }, false, ['deriveBits'])) as CryptoKeyPair;
  const publicKey = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  return sealWith({ privateKey: pair.privateKey, publicKey }, audioKey, op, owner, wav);
}

/**
 * Seals with the ephemeral key that `ikm` gives (RFC 9180 DeriveKeyPair). Only for the shared
 * vector `crates/voice-verifier/testdata/sealed_audio_v1.json`: a fixed `ikm` gives fixed bytes.
 */
export async function sealAudioFromIkm(
  ikm: Uint8Array,
  audioKey: Uint8Array,
  op: SealedAudioOp,
  owner: string,
  wav: Uint8Array,
): Promise<Bytes> {
  const prk = await labeledExtract(KEM_SUITE, EMPTY, 'dkp_prk', ikm);
  const secret = await labeledExpand(KEM_SUITE, prk, 'sk', EMPTY, AUDIO_KEY_BYTES);
  const privateKey = await crypto.subtle.importKey('pkcs8', concat(X25519_PKCS8_PREFIX, secret), { name: 'X25519' }, false, [
    'deriveBits',
  ]);
  const publicKey = await x25519(privateKey, X25519_BASE_POINT);
  return sealWith({ privateKey, publicKey }, audioKey, op, owner, wav);
}

/**
 * Reads the verifier's `audio_key` output and returns the audio key, or null if the output is not
 * an accept that `verdictKey` signed. `verdictKey` is the 32-byte ed25519 key that the caller
 * already pins for verdicts, so a server between them cannot put its own audio key here.
 */
export async function readAudioKeyOutput(output: unknown, verdictKey: Uint8Array): Promise<Bytes | null> {
  if (typeof output !== 'object' || output === null) return null;
  const { kind, outcome, audio_public_key_b64: keyText, signature_b64: signatureText } = output as Record<string, unknown>;
  if (kind !== AUDIO_KEY_OUTPUT_KIND || outcome !== 'accept') return null;
  const audioKey = fromBase64(keyText);
  const signature = fromBase64(signatureText);
  if (audioKey?.length !== AUDIO_KEY_BYTES || signature?.length !== 64 || verdictKey.length !== 32) return null;
  const message = new Uint8Array(await crypto.subtle.digest('SHA-256', concat(AUDIO_KEY_DOMAIN, audioKey)));
  try {
    const key = await crypto.subtle.importKey('raw', copy(verdictKey), { name: 'Ed25519' }, false, ['verify']);
    return (await crypto.subtle.verify({ name: 'Ed25519' }, key, signature, message)) ? audioKey : null;
  } catch {
    return null;
  }
}

/** Standard base64 of a sealed clip (the verifier's `audio_sealed_b64`). */
export function sealedBase64(sealed: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let offset = 0; offset < sealed.length; offset += chunk) {
    binary += String.fromCharCode(...sealed.subarray(offset, offset + chunk));
  }
  return btoa(binary);
}

type EphemeralKey = Readonly<{ privateKey: CryptoKey; publicKey: Bytes }>;

/** RFC 9180 SetupBaseS and one Seal: `enc || ciphertext || tag`. */
async function sealWith(
  ephemeral: EphemeralKey,
  audioKey: Uint8Array,
  op: SealedAudioOp,
  owner: string,
  wav: Uint8Array,
): Promise<Bytes> {
  if (audioKey.length !== AUDIO_KEY_BYTES) throw new Error('The audio key is not 32 bytes.');
  const recipient = copy(audioKey);
  // Encap: the shared secret from the Diffie-Hellman value and both public keys.
  const dh = await x25519(ephemeral.privateKey, recipient);
  if (dh.every((byte) => byte === 0)) throw new Error('The audio key is not a valid X25519 key.');
  const enc = ephemeral.publicKey;
  const eaePrk = await labeledExtract(KEM_SUITE, EMPTY, 'eae_prk', dh);
  const sharedSecret = await labeledExpand(KEM_SUITE, eaePrk, 'shared_secret', concat(enc, recipient), HASH_BYTES);
  // KeySchedule, base mode: no pre-shared key.
  const pskIdHash = await labeledExtract(HPKE_SUITE, EMPTY, 'psk_id_hash', EMPTY);
  const infoHash = await labeledExtract(HPKE_SUITE, EMPTY, 'info_hash', INFO);
  const context = concat(bytes(0x00), pskIdHash, infoHash);
  const secret = await labeledExtract(HPKE_SUITE, sharedSecret, 'secret', EMPTY);
  const key = await labeledExpand(HPKE_SUITE, secret, 'key', context, AEAD_KEY_BYTES);
  const nonce = await labeledExpand(HPKE_SUITE, secret, 'base_nonce', context, AEAD_NONCE_BYTES);
  // One message per context, so the nonce is the base nonce (sequence number 0).
  const aesKey = await crypto.subtle.importKey('raw', key, { name: 'AES-GCM' }, false, ['encrypt']);
  const additionalData = concat(ascii(op), bytes(0x00), new TextEncoder().encode(owner));
  const sealed = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, additionalData, tagLength: 128 }, aesKey, copy(wav));
  return concat(enc, new Uint8Array(sealed));
}

async function x25519(privateKey: CryptoKey, publicKey: Uint8Array): Promise<Bytes> {
  const peer = await crypto.subtle.importKey('raw', copy(publicKey), { name: 'X25519' }, false, []);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'X25519', public: peer }, privateKey, 256));
}

/** RFC 9180 LabeledExtract. An empty salt is a salt of zeros (RFC 5869). */
function labeledExtract(suite: Bytes, salt: Uint8Array, label: string, ikm: Uint8Array): Promise<Bytes> {
  return hmac(salt.length === 0 ? new Uint8Array(HASH_BYTES) : salt, concat(VERSION, suite, ascii(label), ikm));
}

/** RFC 9180 LabeledExpand for at most one hash block (32 bytes). */
async function labeledExpand(suite: Bytes, prk: Uint8Array, label: string, info: Uint8Array, length: number): Promise<Bytes> {
  if (length > HASH_BYTES) throw new Error('labeledExpand: more than one block');
  const labeled = concat(bytes(length >> 8, length & 0xff), VERSION, suite, ascii(label), info);
  return (await hmac(prk, concat(labeled, bytes(0x01)))).slice(0, length);
}

async function hmac(key: Uint8Array, message: Uint8Array): Promise<Bytes> {
  const hmacKey = await crypto.subtle.importKey('raw', copy(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', hmacKey, copy(message)));
}

function bytes(...values: number[]): Bytes {
  return new Uint8Array(values);
}

function ascii(text: string): Bytes {
  return Uint8Array.from(text, (char) => char.charCodeAt(0));
}

/** A copy on its own `ArrayBuffer`, as WebCrypto's types need. */
function copy(source: Uint8Array): Bytes {
  return new Uint8Array(source);
}

function concat(...parts: Uint8Array[]): Bytes {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function fromBase64(text: unknown): Bytes | null {
  if (typeof text !== 'string') return null;
  try {
    return Uint8Array.from(atob(text), (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
}
