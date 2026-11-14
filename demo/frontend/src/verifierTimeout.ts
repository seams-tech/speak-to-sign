// An OutLayer timeout: the verify route waited for the verifier on OutLayer, and no answer came
// in time. The cause is OutLayer, not this app and not the recording, so the page says so and
// links to OutLayer's list of executions (components/Toasts.tsx, `toastOutlayerTimeout`).
//
// A slow answer: the Wallet gives the page its result only when the card closes, so the timeout
// toast comes after the card. While the card still waits for the verifier, the page says that
// OutLayer is busy, after OUTLAYER_BUSY_MS (`outlayerWait`).
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

/** After this long with no answer of the verifier, the page says that OutLayer is busy. */
export const OUTLAYER_BUSY_MS = 10_000;

/** One wait for the verifier on OutLayer. `start` and `stop` can run more than once. */
export type OutlayerWait = Readonly<{ start(): void; stop(): void }>;

/**
 * Times the waits of one request for the verifier. `start`: the wait begins; after `ms` with no
 * `stop`, `busy` runs one time. `stop`: the verifier answered or the request ended; `clear` runs
 * if `busy` ran. A request that records again starts a new wait.
 */
export function outlayerWait(busy: () => void, clear: () => void, ms: number = OUTLAYER_BUSY_MS): OutlayerWait {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let shown = false;
  return {
    start() {
      if (timer !== null || shown) return;
      timer = setTimeout(() => {
        timer = null;
        shown = true;
        busy();
      }, ms);
    },
    stop() {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      if (shown) clear();
      shown = false;
    },
  };
}

/**
 * The progress of a spoken request (the Wallet SDK's `onProgress`): the wait begins when the
 * Wallet sends the recording to the verify route, and each later stage ends it. The verifier
 * sends one answer at the end, so there is no stage between.
 */
export function watchRequestProgress(wait: OutlayerWait, stage: string): void {
  if (stage === 'recording_sent' || stage === 'verifier_running') wait.start();
  else wait.stop();
}

/** The parts of the enrollment card's line that are done before the verifier: the recordings and the signed message. */
const ENROLL_PARTS_BEFORE_VERIFIER = 2;

/**
 * The stage of an enrollment card in a dialog of the page (the Wallet SDK's card progress). The
 * verifier runs in the check, after the recordings and the owner's signed message. An enrollment
 * card in the Wallet's own modal reports no stage, so it has no wait.
 */
export function watchEnrollmentCard(wait: OutlayerWait, progress: Readonly<{ stage: string; done: number }>): void {
  if (progress.stage === 'checking' && progress.done >= ENROLL_PARTS_BEFORE_VERIFIER) wait.start();
  else wait.stop();
}
