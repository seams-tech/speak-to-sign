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
export type SpokenResult =
  | Extract<SpeakToSignTransferResult, { kind: 'sent' }>
  | Readonly<{ kind: 'cancelled' }>
  | FailedResult;

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

type StageTimes = Readonly<{
  speechMs: number;
  verifyMs: number;
  verifiedAt: number;
  endOfSpeechAt: number;
}>;

export function mapPayment(payment: SpeakToSignPayment, times: StageTimes): SpokenResult {
  const receiptAt = performance.now();
  switch (payment.kind) {
    case 'executed':
      return {
        kind: 'sent',
        transactionHash: payment.transactionHash,
        approval: payment.approval,
        times: {
          speechMs: times.speechMs,
          verifyMs: times.verifyMs,
          transactionMs: Math.round(receiptAt - times.verifiedAt),
          endOfSpeechToReceiptMs: Math.round(receiptAt - times.endOfSpeechAt),
        },
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
