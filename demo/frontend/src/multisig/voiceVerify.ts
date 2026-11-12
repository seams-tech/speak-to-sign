// The multisig page's call to the voice verifier (../voiceRoute.ts): a `verify` input of the kind
// `multisig_propose` (the proposer says a new transfer) or `multisig_confirm` (another signer says
// a stored proposal from memory; the input names only its commitment). The answer is the verifier
// output unchanged: `verdict_json` (the signed bytes, a string), `signature_b64`, and for an
// accepted proposal the `multisig` opening (base64url commitment and salt).

import { callVerifier } from '../voiceRoute.ts';
import { hexOfBase64Url } from './intent.ts';

export type MultisigVoiceRequest =
  | { kind: 'multisig_propose'; multisig: string; proposal_id: number; receiver: string; amount_yocto: string }
  | { kind: 'multisig_confirm'; multisig: string; proposal_id: number; commitment_hex: string };

/** A verdict as the verifier signed it: the exact bytes and the signature. */
export interface SignedVerdict {
  verdictJson: string;
  signatureB64: string;
}

export type VoiceCheck =
  /** `opening`: only for `multisig_propose`. */
  | { kind: 'accepted'; verdict: SignedVerdict; opening: { commitmentHex: string; saltHex: string } | null }
  /**
   * `heard`: what the verifier heard, on a `words` refusal. `signed`: the signed refusal, which
   * the contract refuses too; the page can send it as a record.
   */
  | { kind: 'refused'; reason: string; code: string; heard?: string; signed?: SignedVerdict }
  | { kind: 'unavailable'; reason: string };

interface VerifyOutput {
  kind?: string;
  verdict_json?: string;
  signature_b64?: string | null;
  detail?: string | null;
  reason?: string;
  multisig?: { commitment?: string; salt?: string } | null;
}

interface Verdict {
  outcome?: string;
  reason?: string | null;
  heard?: string | null;
}

export async function checkVoice(owner: string, request: MultisigVoiceRequest, wav: Uint8Array): Promise<VoiceCheck> {
  const answer = await callVerifier<VerifyOutput>(owner, request, wav);
  return answer.kind === 'output' ? readVerifyOutput(answer.output, request.kind === 'multisig_propose') : answer;
}

/** The verifier output as the page uses it. `proposing`: the accept must carry an opening. */
export function readVerifyOutput(output: VerifyOutput, proposing: boolean): VoiceCheck {
  if (output.kind === 'seams_voice_error_v1') {
    const code = output.reason ?? 'unsupported';
    return { kind: 'refused', code, reason: reasonText(code, null) };
  }
  if (output.kind !== 'seams_voice_verify_output_v2' || typeof output.verdict_json !== 'string') {
    return { kind: 'unavailable', reason: 'The verifier gave an answer that this page cannot read.' };
  }
  let verdict: Verdict;
  try {
    verdict = JSON.parse(output.verdict_json) as Verdict;
  } catch {
    return { kind: 'unavailable', reason: 'The verifier gave a verdict that this page cannot read.' };
  }
  const signed = output.signature_b64 ? { verdictJson: output.verdict_json, signatureB64: output.signature_b64 } : undefined;
  if (verdict.outcome === 'refuse') {
    const code = verdict.reason ?? 'unsupported';
    // A words refusal shows what was heard and nothing about the expected words.
    const heard = code === 'words' ? (verdict.heard ?? undefined) : undefined;
    return { kind: 'refused', code, reason: reasonText(code, code === 'words' ? null : (output.detail ?? null)), heard, signed };
  }
  if (verdict.outcome !== 'accept') {
    return { kind: 'refused', code: 'step_up', reason: 'The verifier asked for a passkey as well. The multisig contract takes only an accept.', signed };
  }
  if (!signed) {
    return { kind: 'unavailable', reason: `The verifier accepted, but could not sign the verdict. ${output.detail ?? ''}`.trim() };
  }
  if (!proposing) return { kind: 'accepted', verdict: signed, opening: null };
  const commitmentHex = hexOfBase64Url(output.multisig?.commitment ?? '', 32);
  const saltHex = hexOfBase64Url(output.multisig?.salt ?? '', 32);
  if (!commitmentHex || !saltHex) {
    return { kind: 'unavailable', reason: 'The verifier accepted, but gave no proposal commitment. Its version may not have the multisig kinds.' };
  }
  return { kind: 'accepted', verdict: signed, opening: { commitmentHex, saltHex } };
}

/** The verifier's refusal reasons, in plain words. */
const REASONS: Record<string, string> = {
  quality: 'The recording was too short or too quiet. Speak close to the microphone.',
  speaker: 'The voice did not match the voice enrolled for this account.',
  same_speaker: 'This voice matches another signer who already approved this proposal. One person cannot approve twice.',
  words: 'The words did not match the proposal.',
  attempts_exhausted: 'This signer has no tries left for this proposal: three tries had wrong words.',
  proposal_missing: 'The verifier has no record of this proposal.',
  audio_reused: 'This recording was used before. Record again.',
  audio_invalid: 'The verifier could not read the recording.',
  // Over HTTPS the verifier keeps templates in the storage of the payment-key owner, so a
  // route with another OutLayer payment key than the Seams one finds no template.
  template_missing: 'This account has no voice on this verifier. Do “Set up your voice” on this page first.',
  unsupported: 'The verifier does not support this request.',
  speaker_unavailable: 'The speaker check service did not answer. Try again.',
  storage: 'The verifier could not read or write its record. Try again.',
  transcriber_unavailable: 'The speech-to-text service did not answer. Try again.',
};

function reasonText(reason: string, detail: string | null): string {
  const text = REASONS[reason] ?? `The verifier refused (${reason}).`;
  return detail ? `${text} (${detail})` : text;
}
