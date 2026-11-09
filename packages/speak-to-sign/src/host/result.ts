import type {
  SpeakToSignPayment,
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
        | 'voice_limit'
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

export function mapPayment(payment: SpeakToSignPayment, times: SentResult['times']): SpokenResult {
  switch (payment.kind) {
    case 'executed':
      return {
        kind: 'sent',
        transactionHash: payment.transactionHash,
        approval: payment.approval,
        times,
      };
    case 'reverted':
      return { kind: 'refused', reason: 'transaction_failed', detail: payment.error };
    case 'refused':
      return payment.detail === undefined
        ? { kind: 'refused', reason: payment.reason }
        : { kind: 'refused', reason: payment.reason, detail: payment.detail };
    case 'cancelled':
      return payment;
    case 'unavailable':
      return verifierUnavailable(payment.detail);
    case 'not_submitted':
    case 'submission_unknown':
      return { kind: 'unavailable', reason: payment.kind, detail: payment.error };
    default:
      return payment satisfies never;
  }
}
