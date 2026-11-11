import type {
  SpeakToSignMessageResult,
  SpeakToSignNoteActionResult,
  SpeakToSignSigning,
  SpeakToSignTransferResult,
  VerifierRefusal,
} from '@seams/wallet/speak-to-sign-host';

/** A failure after the card opened. The flow refuses an unspeakable request before that. */
export type FailedResult =
  | Readonly<{
      kind: 'refused';
      reason:
        | VerifierRefusal
        | 'verdict_mismatch'
        | 'cosigner_refused'
        | 'transaction_failed';
      detail?: string;
    }>
  | Readonly<{
      kind: 'unavailable';
      reason: 'voiceid_unavailable' | 'verifier_unavailable' | 'not_submitted' | 'submission_unknown';
      detail?: string;
    }>;

/** What a spoken request returns once its card opened. Both result types accept it. */
export type SpokenResult = SentResult | Readonly<{ kind: 'cancelled' }> | FailedResult;
type SentResult = Extract<SpeakToSignTransferResult, { kind: 'sent' }>;

/** A result carries at most this much of a free-text detail from core or the verifier. */
const MAX_DETAIL_CHARS = 200;

export function shortDetail(text: string): string {
  return text.slice(0, MAX_DETAIL_CHARS);
}

/** The Seams verify route, the verifier or the account check did not answer usefully. */
export function verifierUnavailable(
  detail: string,
): Readonly<{ kind: 'unavailable'; reason: 'verifier_unavailable'; detail: string }> {
  return { kind: 'unavailable', reason: 'verifier_unavailable', detail };
}

/** The `performance.now()` marks of one recording, its verify call and core's outcome. */
type StageMarks = Readonly<{
  speechMs: number;
  endOfSpeechAt: number;
  verifyStartedAt: number;
  verifiedAt: number;
  receiptAt: number;
}>;

/** Milliseconds of each stage of a sent request. */
export function stageTimes(marks: StageMarks): SentResult['times'] {
  return {
    speechMs: marks.speechMs,
    verifyMs: Math.round(marks.verifiedAt - marks.verifyStartedAt),
    transactionMs: Math.round(marks.receiptAt - marks.verifiedAt),
    endOfSpeechToReceiptMs: Math.round(marks.receiptAt - marks.endOfSpeechAt),
  };
}

/** VoiceID could not load or record on this Wallet host. */
export function voiceIdUnavailable(
  detail: string,
): Readonly<{ kind: 'unavailable'; reason: 'voiceid_unavailable'; detail: string }> {
  return { kind: 'unavailable', reason: 'voiceid_unavailable', detail };
}

/** A transaction or a delegate action that core signed and did not send. */
type SignedNoteResult = Extract<
  SpeakToSignNoteActionResult,
  { kind: 'signed_transaction' | 'signed_delegate' }
>;
type SignedMessageResult = Extract<SpeakToSignMessageResult, { kind: 'signed' }>;

/**
 * The result of the request from what core did: a sent transaction, a signature that core did
 * not send, a cancel or a failure. The times go on each success.
 */
export function mapSigning(
  signing: SpeakToSignSigning,
  times: SentResult['times'],
): SpokenResult | SignedNoteResult | SignedMessageResult {
  switch (signing.kind) {
    case 'signed_transaction':
    case 'signed_delegate':
    case 'signed':
      return { ...signing, times };
    case 'executed':
      return {
        kind: 'sent',
        transactionHash: signing.transactionHash,
        approval: signing.approval,
        times,
      };
    case 'reverted':
      return { kind: 'refused', reason: 'transaction_failed', detail: signing.error };
    case 'refused':
      return signing.detail === undefined
        ? { kind: 'refused', reason: signing.reason }
        : { kind: 'refused', reason: signing.reason, detail: signing.detail };
    case 'cancelled':
      return signing;
    case 'unavailable':
      return verifierUnavailable(signing.detail);
    case 'not_signed':
      return { kind: 'unavailable', reason: 'not_submitted', detail: signing.error };
    case 'not_submitted':
    case 'submission_unknown':
      return { kind: 'unavailable', reason: signing.kind, detail: signing.error };
    default:
      return signing satisfies never;
  }
}
