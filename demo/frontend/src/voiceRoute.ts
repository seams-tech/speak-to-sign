// The page's one call to the voice verifier: POST /api/voice-verify (functions/api/voice-verify.ts)
// with a `verify` input. The answer is the verifier output, unchanged.
//
// With an audio key, the recording is sealed to the verifier before it leaves the page
// (`audio_sealed_b64`), so the route and OutLayer's coordinator carry only ciphertext and the
// verifier opens it inside its TEE. Without one, the recording goes as a plain WAV
// (`audio_wav_b64`). The key is `VITE_VOICE_AUDIO_KEY`: the verifier's `audio_key` answer, after
// scripts/audio-key.mjs checked its signature against the verdict key.

import { AUDIO_KEY_BYTES, sealAudio } from '../../../packages/voice-verdict/src/audioEnvelope.ts';
import { base64 } from './multisig/wav.ts';

/** The verifier's audio key (32 bytes), or null if this build has none. Node tests have no `env`. */
export const AUDIO_KEY = readAudioKey(import.meta.env?.VITE_VOICE_AUDIO_KEY);

/** Standard base64 of 32 bytes, or null for an empty or malformed value. */
export function readAudioKey(text: string | undefined): Uint8Array | null {
  try {
    const key = Uint8Array.from(atob((text ?? '').trim()), (char) => char.charCodeAt(0));
    return key.length === AUDIO_KEY_BYTES ? key : null;
  } catch {
    return null;
  }
}

/** The verifier's `verify` input for one recording, sealed to `audioKey` if there is one. */
export async function verifyInput(
  owner: string,
  request: Readonly<Record<string, unknown>>,
  wav: Uint8Array,
  audioKey: Uint8Array | null,
): Promise<Record<string, unknown>> {
  const audio = audioKey
    ? { audio_sealed_b64: base64(await sealAudio(audioKey, 'verify', owner, wav)) }
    : { audio_wav_b64: base64(wav) };
  return { op: 'verify', owner, request, contacts: [], ...audio };
}

export type VerifierAnswer<Output> = { kind: 'output'; output: Output } | { kind: 'unavailable'; reason: string };

/** Sends one recording of the request's sentence to the verifier. */
export async function callVerifier<Output extends object>(
  owner: string,
  request: Readonly<Record<string, unknown>>,
  wav: Uint8Array,
): Promise<VerifierAnswer<Output>> {
  let response: Response;
  try {
    const input = await verifyInput(owner, request, wav, AUDIO_KEY);
    response = await fetch('/api/voice-verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input }),
    });
  } catch {
    return { kind: 'unavailable', reason: 'The page could not reach the voice verifier.' };
  }
  const body = (await response.json().catch(() => null)) as (Output & { error?: unknown }) | null;
  if (!response.ok || body === null) {
    const reason = typeof body?.error === 'string' ? body.error : `The verify route answered ${response.status}.`;
    return { kind: 'unavailable', reason };
  }
  return { kind: 'output', output: body };
}
