// The multisig page's call to the voice verifier (../voiceRoute.ts): a `verify` input of the kind
// `multisig_propose` (a transfer) or `multisig_hide_note`. The answer is the verifier output
// unchanged: `verdict_json` (the signed bytes, a string), `signature_b64`, and on an accept the
// `multisig` opening (base64url commitment and salt).

import { hexOfBase64Url } from './intent';
import { callVerifier } from '../voiceRoute';

export type MultisigVoiceRequest =
  | { kind: 'multisig_propose'; multisig: string; proposal_id: number; receiver: string; amount_yocto: string }
  | { kind: 'multisig_hide_note'; multisig: string; proposal_id: number; note_id: number };

export type VoiceCheck =
  | { kind: 'accepted'; verdictJson: string; signatureB64: string; commitmentHex: string; saltHex: string }
  /** `heard`: what the verifier heard, on a `words` refusal. */
  | { kind: 'refused'; reason: string; heard?: string }
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
  return answer.kind === 'output' ? readOutput(answer.output) : answer;
}

function readOutput(output: VerifyOutput): VoiceCheck {
  if (output.kind === 'seams_voice_error_v1') return { kind: 'refused', reason: reasonText(output.reason ?? 'unsupported', null) };
  if (output.kind !== 'seams_voice_verify_output_v2' || typeof output.verdict_json !== 'string') {
    return { kind: 'unavailable', reason: 'The verifier gave an answer that this page cannot read.' };
  }
  let verdict: Verdict;
  try {
    verdict = JSON.parse(output.verdict_json) as Verdict;
  } catch {
    return { kind: 'unavailable', reason: 'The verifier gave a verdict that this page cannot read.' };
  }
  if (verdict.outcome === 'refuse') {
    const reason = verdict.reason ?? 'unsupported';
    // A words refusal shows what was heard and nothing about the expected words.
    if (reason === 'words') return { kind: 'refused', reason: reasonText(reason, null), heard: verdict.heard ?? undefined };
    return { kind: 'refused', reason: reasonText(reason, output.detail ?? null) };
  }
  if (verdict.outcome !== 'accept') {
    return { kind: 'refused', reason: 'The verifier asked for a passkey as well. The multisig contract takes only an accept.' };
  }
  if (!output.signature_b64) {
    return { kind: 'unavailable', reason: `The verifier accepted, but could not sign the verdict. ${output.detail ?? ''}`.trim() };
  }
  const commitmentHex = hexOfBase64Url(output.multisig?.commitment ?? '', 32);
  const saltHex = hexOfBase64Url(output.multisig?.salt ?? '', 32);
  if (!commitmentHex || !saltHex) {
    return { kind: 'unavailable', reason: 'The verifier accepted, but gave no proposal commitment. Its version may not have the multisig kinds.' };
  }
  return { kind: 'accepted', verdictJson: output.verdict_json, signatureB64: output.signature_b64, commitmentHex, saltHex };
}

/** The verifier's refusal reasons, in plain words. */
const REASONS: Record<string, string> = {
  quality: 'The recording was too short or too quiet. Speak close to the microphone.',
  speaker: 'The voice did not match the voice enrolled for this account.',
  words: 'The words did not match the proposal.',
  audio_reused: 'This recording was used before. Record again.',
  audio_invalid: 'The verifier could not read the recording.',
  // Over HTTPS the verifier keeps templates in the storage of the payment-key owner, so a
  // route with another OutLayer payment key than the Seams one finds no template.
  template_missing:
    'This account has no voice on this verifier. Enroll VoiceID in Seams Wallet first (“Set up your voice” in the setup card on this page); if you did, the demo route uses another OutLayer payment key.',
  unsupported: 'The verifier does not support this request. Its version may not have this multisig kind yet.',
  speaker_unavailable: 'The speaker check service did not answer. Try again.',
  storage: 'The verifier could not read or write its record. Try again.',
  transcriber_unavailable: 'The speech-to-text service did not answer. Try again.',
};

function reasonText(reason: string, detail: string | null): string {
  const text = REASONS[reason] ?? `The verifier refused (${reason}).`;
  return detail ? `${text} (${detail})` : text;
}
