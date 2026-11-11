// The spoken bet of the pm-notes contract: the sentence that a bettor says, and the call to the
// voice verifier (../voiceRoute.ts, request kind `market_bet`). The verifier checks that
// the voice is the account owner's and that the words are this bet, and signs a verdict. The
// contract takes the bet only with that verdict (`check_spoken_bet` in the contract).

import { callVerifier } from '../voiceRoute.ts';
import type { BetVoiceCheck, Side } from './types';

/** 0.01 USDC in base units. A spoken amount is a whole number of these. */
const UNITS_PER_HUNDREDTH = 10_000n;

/** "1,250", "2.5" or "0.05": the amount as the verifier's confirm text writes it. */
export function spokenAmount(units: bigint): string | null {
  if (units <= 0n || units % UNITS_PER_HUNDREDTH !== 0n) return null;
  const hundredths = units / UNITS_PER_HUNDREDTH;
  if (hundredths > 100_000_000n) return null;
  const whole = (hundredths / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const fraction = (hundredths % 100n).toString().padStart(2, '0').replace(/0+$/, '');
  return fraction === '' ? whole : `${whole}.${fraction}`;
}

/**
 * The sentence of a bet: "Bet 0.5 USDC yes on market 9". It is the display text of the
 * `MarketBet` request in crates/spoken-intent (render.rs).
 */
export function spokenBetSentence(bet: { marketId: number; side: Side; amount: bigint }): string {
  return `Bet ${spokenAmount(bet.amount) ?? '?'} USDC ${bet.side} on market ${bet.marketId}`;
}

interface VerifyOutput {
  kind?: string;
  verdict_json?: string;
  signature_b64?: string | null;
  detail?: string | null;
  reason?: string;
}

/** The verifier's refusal reasons, in plain words. */
const REASONS: Record<string, string> = {
  quality: 'The recording was too short or too quiet. Speak close to the microphone.',
  speaker: 'The voice did not match the voice of this account.',
  words: 'The words did not match the bet.',
  audio_reused: 'This recording was used before. Record again.',
  audio_invalid: 'The verifier could not read the recording.',
  template_missing: 'This account has no voice yet. Set up your voice first.',
  unsupported: 'The verifier does not know a spoken bet yet.',
  speaker_unavailable: 'The speaker check did not answer. Try again.',
  storage: 'The verifier could not read its record. Try again.',
  transcriber_unavailable: 'The speech-to-text service did not answer. Try again.',
};

const reasonText = (reason: string) => REASONS[reason] ?? `The verifier refused (${reason}).`;

/** Sends the recording of a bet's sentence to the verifier. */
export async function checkSpokenBet(
  accountId: string,
  bet: { market: string; token: string; marketId: number; side: Side; amount: bigint },
  wav: Uint8Array,
): Promise<BetVoiceCheck> {
  const request = { kind: 'market_bet', market: bet.market, token: bet.token, market_id: bet.marketId, outcome: bet.side, amount_units: bet.amount.toString() };
  const answer = await callVerifier<VerifyOutput>(accountId, request, wav);
  return answer.kind === 'output' ? readVerifyOutput(answer.output) : answer;
}

/** The verifier output as the result of a check. */
export function readVerifyOutput(output: VerifyOutput): BetVoiceCheck {
  if (output.kind === 'seams_voice_error_v1') return { kind: 'refused', reason: reasonText(output.reason ?? 'unsupported') };
  if (output.kind !== 'seams_voice_verify_output_v2' || typeof output.verdict_json !== 'string') {
    return { kind: 'unavailable', reason: 'The verifier gave an answer that this page cannot read.' };
  }
  let verdict: { outcome?: string; reason?: string | null; heard?: string | null };
  try {
    verdict = JSON.parse(output.verdict_json) as typeof verdict;
  } catch {
    return { kind: 'unavailable', reason: 'The verifier gave a verdict that this page cannot read.' };
  }
  if (verdict.outcome === 'refuse') {
    const reason = verdict.reason ?? 'unsupported';
    return reason === 'words' && verdict.heard ? { kind: 'refused', reason: reasonText(reason), heard: verdict.heard } : { kind: 'refused', reason: reasonText(reason) };
  }
  // A step-up asks for a passkey as well. The contract takes only an accept.
  if (verdict.outcome !== 'accept') return { kind: 'refused', reason: 'The verifier did not accept this bet by voice alone.' };
  if (!output.signature_b64) return { kind: 'unavailable', reason: 'The verifier accepted, but could not sign the verdict.' };
  return { kind: 'accepted', verdictJson: output.verdict_json, signatureB64: output.signature_b64 };
}
