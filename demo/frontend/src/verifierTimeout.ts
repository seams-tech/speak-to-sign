// An OutLayer timeout: the verify route waited for the verifier on OutLayer, and no answer came
// in time. The cause is OutLayer, not this app and not the recording, so the page says so and
// links to OutLayer's list of executions (components/Toasts.tsx, `toastOutlayerTimeout`).
//
// Two routes report it. The Wallet's verify route gives the result `verifier_unavailable` with
// the detail `verifier_timeout` (a note, a rating, a bet, an enrollment). The page's own route
// (functions/api/voice-verify.ts, for the multisig page) gives the code `verifier_timeout`.

/** The detail of the Wallet's result, and the code of the page's route. */
export const VERIFIER_TIMEOUT = 'verifier_timeout';

/** OutLayer's public list of executions. */
export const OUTLAYER_EXECUTIONS_URL = 'https://app.outlayer.ai/executions';

/** The words for a result card or a step of the page. */
export const OUTLAYER_TIMEOUT_TEXT =
  'OutLayer timed out: the verifier did not answer in time. Your recording is not the cause. Try again in a minute.';

/** True for the Wallet's `unavailable` result of a verify route that gave up on OutLayer. */
export function isVerifierTimeout(unavailable: { reason: string; detail?: string }): boolean {
  return unavailable.reason === 'verifier_unavailable' && unavailable.detail === VERIFIER_TIMEOUT;
}
