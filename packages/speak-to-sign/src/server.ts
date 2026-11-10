/**
 * The server side of Speak-to-Sign for an application with no wallet.
 *
 * Each function calls the verifier (an OutLayer worker) with your payment key and returns a
 * checked result, not a raw output: the verdict passed the check against the key that you pin,
 * for the request that this server built and for the recording that it sent.
 *
 * Keep this code on a server. The payment key pays for each run, and it is the authority for
 * the enrollment of your users.
 */
import {
  audioDigest,
  checkAttestationBinding,
  checkTranscript,
  checkVerdict,
  confirmationRequest,
  fetchAttestation,
  measurementsApproved,
  type ConfirmationRequest,
  type VoiceVerdict,
} from '@seams/voice-verdict';

import { callVerifierWithAttestation, type VerifierConfig, type VerifyOutput } from './client.ts';

export { callVerifier, callVerifierWithAttestation, VerifierCallError } from './client.ts';
export type { EnrollOutput, TranscribeOutput, VerifierCall, VerifierConfig, VerifierInput, VerifyOutput } from './client.ts';

/** A recording: a 16 kHz mono PCM16 WAV, as bytes or as standard base64. */
export type Recording = Uint8Array | string;

/** One action that a user can confirm. The user says `summary`. */
export interface Action {
  /** Your name of the action, for example `shop.example/order`. */
  context: string;
  /** The sentence that the user says: 1 to 12 words of letters. Write a number in words. */
  summary: string;
  /** The bytes that the confirmation is for. The verdict binds their SHA-256. */
  payload?: Uint8Array;
  /** Or the SHA-256 of the payload: 32 bytes or 64 lowercase hex characters. */
  payloadSha256?: Uint8Array | string;
}

/** Remembers the verdicts that this server accepted, so that one verdict confirms one action. */
export interface UsedVerdictStore {
  /** `true` if this call stored the key; `false` if the key was there. It must be atomic. */
  addIfAbsent(key: string, expiresAtMs: number): Promise<boolean> | boolean;
}

export interface SpeakToSignConfig {
  verifier: VerifierConfig;
  /**
   * The verdict key of your payment key, `ed25519:<base58>`. The first `enroll` returns it as
   * `verifierPublicKey`. Pin it in your configuration.
   */
  verifierPublicKey: string;
  /**
   * Also check the TDX quote of each confirming call: the quote must bind the output to one of
   * these WASM hashes (your own builds of the verifier). With `near`, the OutLayer contract must
   * approve the measurements of the quote. The signature chain of the quote to Intel is not
   * checked here.
   */
  attestation?: {
    acceptedWasmHashes: readonly string[];
    near?: { rpcUrl: string; contract: string };
  };
  /** Default: a store in the memory of this process. Use a shared store with several servers. */
  usedVerdicts?: UsedVerdictStore;
  /** Default: `Date.now`. */
  now?: () => number;
}

export type Refused = {
  ok: false;
  /**
   * Why: a reason of the verifier (`speaker`, `words`, `quality`, `audio_reused`,
   * `template_missing`, ...), a refusal of the verdict check (`bad_signature`, `expired`,
   * `request_mismatch`, `audio_mismatch`, `step_up`, ...), `verdict_reused`, `bad_audio`, or
   * `attestation_<code>`.
   */
  reason: string;
  /** What the verifier heard, if a signed verdict says it. */
  heard: string | null;
};

export type Enrolled =
  | { ok: true; templateEpoch: number; agreementMilli: number | null; verifierPublicKey: string | null }
  | { ok: false; reason: string; detail: string | null };
export type Confirmed = { ok: true; verdict: VoiceVerdict; heard: string | null } | Refused;
export type Selected = { ok: true; index: number; verdict: VoiceVerdict; heard: string | null } | Refused;
export type Transcribed = { ok: true; text: string } | Refused;

export interface SpeakToSign {
  /** Makes the voice template of `owner` (`app:<id>`) from three recordings of three sentences. */
  enroll(input: { owner: string; recordings: readonly Recording[] }): Promise<Enrolled>;
  /** Did `owner` say the summary of this one action? */
  confirm(input: { owner: string; action: Action; recording: Recording }): Promise<Confirmed>;
  /** Which of these 2 to 16 actions did `owner` say? */
  select(input: { owner: string; actions: readonly Action[]; recording: Recording }): Promise<Selected>;
  /**
   * What did `owner` say? The result is weaker than a confirmation: the verifier expected no
   * sentence, so a wrong word of the speech-to-text model is a wrong word of `text`. Do not let
   * it approve an action with value.
   */
  transcribe(input: { owner: string; recording: Recording }): Promise<Transcribed>;
}

/** Makes the server side for one verifier and one pinned key. */
export function createSpeakToSign(config: SpeakToSignConfig): SpeakToSign {
  const now = config.now ?? Date.now;
  const used = config.usedVerdicts ?? memoryStore(now);
  const refused = (reason: string, heard: string | null = null): Refused => ({ ok: false, reason, heard });

  /** The request of an action for this owner. */
  const requestOf = (owner: string, action: Action): Promise<ConfirmationRequest> =>
    confirmationRequest({
      owner,
      context: action.context,
      summary: action.summary,
      ...(action.payload === undefined ? {} : { payload: action.payload }),
      ...(action.payloadSha256 === undefined ? {} : { payloadSha256: action.payloadSha256 }),
    });

  /** The checks of a `verify` or `select` output for one request. */
  async function accept(
    call: { output: VerifyOutput; attestationUrl: string | null },
    request: ConfirmationRequest | undefined,
    wav: Uint8Array,
  ): Promise<{ ok: true; verdict: VoiceVerdict } | Refused> {
    const checked = await checkVerdict({
      verdictJson: call.output.verdict_json,
      signatureB64: call.output.signature_b64 ?? '',
      publicKey: config.verifierPublicKey,
      // With no request, no digest can match: a zero digest refuses an accept.
      requestDigest: request?.digest ?? new Uint8Array(32),
      audioDigest: await audioDigest(wav),
      nowMs: now(),
    });
    if (!checked.ok) {
      const refusal = checked.refusal;
      const verdict = 'verdict' in refusal ? refusal.verdict : undefined;
      const reason = refusal.code === 'refused' ? (refusal.reason ?? 'refused') : refusal.code;
      return refused(reason, verdict?.heard ?? null);
    }
    const { verdict } = checked;
    if (config.attestation !== undefined) {
      const problem = await attestationProblem(call);
      if (problem !== null) return refused(`attestation_${problem}`, verdict.heard);
    }
    // One verdict confirms one action. The audio digest names the verdict: the verifier
    // accepts each recording one time.
    if (!(await used.addIfAbsent(verdict.audio_digest ?? '', verdict.expires_at_ms))) {
      return refused('verdict_reused', verdict.heard);
    }
    return { ok: true, verdict };
  }

  async function attestationProblem(call: { output: VerifyOutput; attestationUrl: string | null }): Promise<string | null> {
    const settings = config.attestation!;
    if (call.attestationUrl === null) return 'missing';
    let record;
    try {
      record = await fetchAttestation(config.verifier.baseUrl, call.attestationUrl, { fetch: config.verifier.fetch });
    } catch {
      return 'unavailable';
    }
    const bound = await checkAttestationBinding({
      record,
      output: call.output,
      acceptedWasmHashes: settings.acceptedWasmHashes,
      projectId: config.verifier.project,
    });
    if (!bound.ok) return bound.refusal.code;
    if (settings.near !== undefined) {
      try {
        const approved = await measurementsApproved({
          ...settings.near,
          measurements: bound.measurements,
          fetch: config.verifier.fetch,
        });
        if (!approved) return 'measurements_not_approved';
      } catch {
        return 'measurements_unavailable';
      }
    }
    return null;
  }

  return {
    async enroll({ owner, recordings }) {
      const clips = recordings.map(wavBytes);
      if (clips.length !== 3 || clips.some((clip) => clip === null)) return { ok: false, reason: 'bad_audio', detail: null };
      const { output } = await callVerifierWithAttestation(config.verifier, {
        op: 'enroll',
        owner,
        audio_wav_b64: clips.map((clip) => base64(clip!)),
      });
      if (output.outcome !== 'accept' || output.template_epoch === null) {
        return { ok: false, reason: output.reason ?? 'refused', detail: output.detail };
      }
      return {
        ok: true,
        templateEpoch: output.template_epoch,
        agreementMilli: output.agreement_milli,
        verifierPublicKey: output.verifier_public_key,
      };
    },

    async confirm({ owner, action, recording }) {
      const wav = wavBytes(recording);
      if (wav === null) return refused('bad_audio');
      const request = await requestOf(owner, action);
      const call = await callVerifierWithAttestation(config.verifier, {
        op: 'verify',
        owner,
        request: request.request,
        contacts: [],
        audio_wav_b64: base64(wav),
      });
      const result = await accept(call, request, wav);
      return result.ok ? { ...result, heard: result.verdict.heard } : result;
    },

    async select({ owner, actions, recording }) {
      const wav = wavBytes(recording);
      if (wav === null) return refused('bad_audio');
      const requests = await Promise.all(actions.map((action) => requestOf(owner, action)));
      const call = await callVerifierWithAttestation(config.verifier, {
        op: 'select',
        owner,
        requests: requests.map((request) => request.request),
        contacts: [],
        audio_wav_b64: base64(wav),
      });
      // `selected` is not signed. The verdict is: it must be for the request at that index.
      const index = call.output.selected;
      const request = Number.isInteger(index) ? requests[index as number] : undefined;
      const result = await accept(call, request, wav);
      return result.ok ? { ...result, index: index as number, heard: result.verdict.heard } : result;
    },

    async transcribe({ owner, recording }) {
      const wav = wavBytes(recording);
      if (wav === null) return refused('bad_audio');
      const { output } = await callVerifierWithAttestation(config.verifier, {
        op: 'transcribe',
        owner,
        audio_wav_b64: base64(wav),
      });
      const checked = await checkTranscript({
        transcriptJson: output.transcript_json,
        signatureB64: output.signature_b64 ?? '',
        publicKey: config.verifierPublicKey,
        owner,
        audioDigest: await audioDigest(wav),
        nowMs: now(),
      });
      if (!checked.ok) {
        const refusal = checked.refusal;
        return refused(refusal.code === 'refused' ? (refusal.reason ?? 'refused') : refusal.code);
      }
      return { ok: true, text: checked.transcript.text };
    },
  };
}

/** The bytes of a recording, or `null` if it is not a WAV that the verifier takes. */
function wavBytes(recording: Recording): Uint8Array | null {
  let bytes: Uint8Array;
  if (typeof recording === 'string') {
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(recording) || recording.length % 4 !== 0) return null;
    bytes = Uint8Array.from(atob(recording), (char) => char.charCodeAt(0));
  } else {
    bytes = recording;
  }
  // `audioDigest` throws for audio that the verifier refuses. Check the form here, with no hash.
  const text = (at: number) => String.fromCharCode(...bytes.subarray(at, at + 4));
  return bytes.length >= 44 && text(0) === 'RIFF' && text(8) === 'WAVE' ? bytes : null;
}

function base64(bytes: Uint8Array): string {
  let binary = '';
  for (let start = 0; start < bytes.length; start += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(start, start + 0x8000));
  }
  return btoa(binary);
}

function memoryStore(now: () => number): UsedVerdictStore {
  const expiry = new Map<string, number>();
  return {
    addIfAbsent(key, expiresAtMs) {
      const time = now();
      for (const [stored, until] of expiry) if (until < time) expiry.delete(stored);
      if (expiry.has(key)) return false;
      expiry.set(key, expiresAtMs);
      return true;
    },
  };
}
