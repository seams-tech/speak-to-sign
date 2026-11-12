// The real signer: Seams Wallet Speak-to-Sign (SDK 0.69.2, `seams.near.spoken`).
//
// requestNote and requestRating run one spoken request in the Wallet iframe (its card shows in the
// page's open dialog, src/signer/voiceCard.ts). For a note, the Seams server writes a short
// summary and the card shows it under the note; for a rating, the card shows the rating sentence.
// The owner says it, the verifier checks the voice, the words and (for a note) that the summary
// fits the note, and the Wallet signs `add_note` or `rate_note` from the owner's own account.

import type { SpeakToSignEnrollmentResult, SpeakToSignResult, SpeakToSignSentTransaction } from '@seams/wallet';
import type { useSeams } from '@seams/wallet/react';
import type { NotesSigner, SetupOutcome, SignResult, SignerSetup, SignerStatus } from './notesSigner';
import { isCancelError, isUserRejection } from './rejection';
import { inVoiceCard } from './voiceCard';

type Seams = ReturnType<typeof useSeams>['seams'];
/** The typed spoken requests and the enrollment: `seams.near.spoken` (Wallet 0.69.2). */
type Spoken = NonNullable<Seams['near']['spoken']>;
/** The result of a spoken call that sends a transaction. */
export type SpokenSent = SpeakToSignResult<SpeakToSignSentTransaction, string>;

export interface SeamsOwner {
  seams: Seams;
  walletId: string | null;
  nearAccountId: string | null;
  contract: string;
}

const NO_KEY = 'This build has no Seams publishable key (VITE_SEAMS_PUBLISHABLE_KEY), so it cannot reach the Wallet.';

/** The signer of a build without a Seams publishable key. */
export function createMissingKeySigner(): NotesSigner & SignerSetup {
  return {
    status: async () => ({ signedIn: false, voiceReady: false }),
    requestNote: async () => ({ kind: 'unavailable', reason: NO_KEY }),
    requestRating: async () => ({ kind: 'unavailable', reason: NO_KEY }),
    enableVoice: async () => ({ kind: 'failed', message: NO_KEY }),
    enroll: async () => ({ kind: 'failed', message: NO_KEY }),
  };
}

export function createSeamsSigner(owner: SeamsOwner): NotesSigner & SignerSetup {
  const { seams, walletId, nearAccountId, contract } = owner;

  const run = async (call: (spoken: Spoken, walletId: string) => Promise<SpokenSent>): Promise<SignResult> => {
    if (!walletId) return { kind: 'unavailable', reason: 'Sign in to Seams Wallet first.' };
    const spoken = seams.near.spoken;
    if (!spoken) return { kind: 'unavailable', reason: 'Speak-to-Sign is not in the Wallet configuration.' };
    const id = walletId;
    return await spokenRequest(seams, id, () => call(spoken, id));
  };

  return {
    async status(): Promise<SignerStatus> {
      if (!walletId) return { signedIn: false, voiceReady: false };
      const availability = await seams.registration.getAuthMethodAvailability({ walletId, method: 'voiceid' });
      return { signedIn: true, accountId: nearAccountId ?? undefined, voiceReady: availability.kind === 'enabled' };
    },

    // The Seams server writes the summary, and the Wallet card shows it under the note.
    requestNote: ({ postId, text }) =>
      run((spoken, id) => inVoiceCard((place) => spoken.note({ walletSession: id, contract, postId, text, ...place }))),

    requestRating: ({ noteId, rating }) =>
      run((spoken, id) => inVoiceCard((place) => spoken.rating({ walletSession: id, contract, noteId, rating, ...place }))),

    async enableVoice(): Promise<SetupOutcome> {
      if (!walletId) return { kind: 'failed', message: 'Sign in to Seams Wallet first.' };
      const id = walletId;
      return await setupStep(seams, id, async () => {
        const availability = await seams.registration.getAuthMethodAvailability({ walletId: id, method: 'voiceid' });
        if (availability.kind === 'disabled') {
          await seams.registration.setAuthMethodEnabled({ walletId: id, method: 'voiceid', enabled: true });
          return { kind: 'done', message: 'VoiceID is on again.' };
        }
        // A wallet without VoiceID gets it in the enrollment: the Wallet turns it on and enrolls
        // the verifier from the same three recordings.
        return { kind: 'done', message: availability.kind === 'enabled' ? 'VoiceID is on.' : 'The enrollment turns on VoiceID.' };
      });
    },

    async enroll(): Promise<SetupOutcome> {
      if (!walletId) return { kind: 'failed', message: 'Sign in to Seams Wallet first.' };
      const id = walletId;
      const spoken = seams.near.spoken;
      if (!spoken) return { kind: 'failed', message: 'Speak-to-Sign is not in the Wallet configuration.' };
      return await setupStep(seams, id, () => enrollOnce(spoken, id));
    },
  };
}

/** The Wallet's messages that ask for a fresh owner unlock. */
const NEEDS_UNLOCK = /unlock (the|this) wallet|custody seed|requires an active owner wallet session/i;

/** The passkey unlock that a Wallet call asked for did not finish. */
class UnlockFailed extends Error {
  /** True when the owner closed the passkey window. */
  readonly closed: boolean;
  constructor(error: string) {
    super(error);
    this.closed = isUserRejection(error);
  }
}

/**
 * Runs a Wallet call. Some calls need a Wallet session with a fresh passkey unlock (a spoken
 * request, or the custody seed of a setup step), and a session that a page reload restored does
 * not have it. If the Wallet asks for that, unlock with the passkey once and run the call again.
 */
async function afterUnlock<T>(seams: Seams, walletId: string, call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (cause) {
    if (!NEEDS_UNLOCK.test(errorText(cause))) throw cause;
  }
  const unlock = await seams.auth.unlock(walletId);
  if (!unlock.success) throw new UnlockFailed(unlock.error ?? '');
  return await call();
}

/** A closed Wallet or passkey window ("Request cancelled.") is the owner's choice, not a failure. */
function closedByOwner(cause: unknown): boolean {
  return isCancelError(cause) || (cause instanceof UnlockFailed && cause.closed);
}

/** A thrown Wallet error, in plain words for the result card. */
export function walletErrorText(cause: unknown): string {
  if (cause instanceof UnlockFailed) return 'Your wallet is locked, and the passkey unlock did not finish.';
  const text = errorText(cause);
  return NEEDS_UNLOCK.test(text) ? 'Your wallet is locked. Unlock it with your passkey, then try again.' : text;
}

/** One spoken request that sends a transaction, as a result for the page. */
export async function spokenRequest(seams: Seams, walletId: string, call: () => Promise<SpokenSent>): Promise<SignResult> {
  try {
    return toSignResult(await afterUnlock(seams, walletId, call));
  } catch (cause) {
    return closedByOwner(cause) ? { kind: 'cancelled' } : { kind: 'unavailable', reason: walletErrorText(cause) };
  }
}

/** Runs a setup step, with the unlock of afterUnlock. */
async function setupStep(seams: Seams, walletId: string, step: () => Promise<SetupOutcome>): Promise<SetupOutcome> {
  try {
    return await afterUnlock(seams, walletId, step);
  } catch (cause) {
    return closedByOwner(cause) ? CLOSED : { kind: 'failed', message: walletErrorText(cause) };
  }
}

/** The owner closed a Wallet or passkey window. The page shows no note for it. */
const CLOSED: SetupOutcome = { kind: 'cancelled', message: 'You closed a Wallet window. Nothing was enrolled.' };

/** One verifier enrollment. A thrown error goes to setupStep. */
async function enrollOnce(spoken: Spoken, walletId: string): Promise<SetupOutcome> {
  const result: SpeakToSignEnrollmentResult = await inVoiceCard((place) => spoken.enroll({ walletSession: walletId, ...place }));
  switch (result.kind) {
    case 'enrolled':
      return { kind: 'done', message: `The verifier stored your voice (template ${result.templateEpoch}).` };
    case 'refused':
      return { kind: 'failed', message: withDetail(ENROLL_REFUSALS[result.reason] ?? `The verifier refused (${result.reason}).`, result.detail) };
    case 'cancelled':
      return { kind: 'cancelled', message: 'You closed a Wallet window. Nothing was enrolled.' };
    case 'unavailable':
      return { kind: 'failed', message: unavailableText(result) };
  }
}

export function toSignResult(result: SpokenSent): SignResult {
  switch (result.kind) {
    case 'approved':
      return {
        kind: 'sent',
        transactionHash: result.result.transactionHash,
        approval: result.approval,
        endOfSpeechToReceiptMs: result.times.endOfSpeechToReceiptMs,
      };
    case 'refused':
      return { kind: 'refused', reason: withDetail(REFUSALS[result.reason] ?? `The Wallet refused (${result.reason}).`, result.detail) };
    case 'cancelled':
      return { kind: 'cancelled' };
    case 'unavailable':
      return { kind: 'unavailable', reason: unavailableText(result) };
  }
}

/** Refusals of the verifier, the verdict check and the chain, in plain words. */
const REFUSALS: Record<string, string> = {
  quality: 'The recording was too short or too quiet.',
  speaker: 'The voice did not match the voice enrolled for this account.',
  words: 'The words did not match the sentence.',
  audio_reused: 'This recording was used before.',
  audio_invalid: 'The verifier could not read the recording.',
  template_missing: 'No voice is enrolled for this account. Enroll your voice first.',
  unsupported: 'The verifier does not support this request.',
  speaker_unavailable: 'The speaker check service did not answer.',
  storage: 'The verifier could not store its record.',
  transcriber_unavailable: 'The speech-to-text service did not answer.',
  // Verifier 0.14.0 and later: the NEAR AI gateway failed its TEE check.
  transcriber_not_attested: 'The speech-to-text service did not pass its TEE check, so the verifier did not use it.',
  summary_not_speakable: 'The summary must be 1 to 12 words of letters A to Z.',
  summary_mismatch: 'The verifier found that the summary does not give the main point of the note.',
  summary_check_unavailable: 'The summary check service did not answer.',
  note_not_valid: 'The note, the contract or the id is not valid.',
  bet_not_valid: 'The market, the outcome or the amount of the bet is not valid.',
  verdict_mismatch: 'The signed verdict did not match this request, so the Wallet signed nothing.',
  transaction_failed: 'The transaction failed on chain.',
  // The Seams co-signer refused the verdict. `detail` holds its reason.
  cosigner_refused: 'Seams did not accept the verdict, so nothing was signed.',
};

const UNAVAILABLE: Record<string, string> = {
  flow_not_available: 'The Seams Wallet on this server has no spoken notes yet.',
  voiceid_unavailable: 'VoiceID is not on for this wallet. Turn it on in the setup steps.',
  verifier_unavailable: 'The Speak-to-Sign verifier did not answer.',
  summary_unavailable: 'Seams could not write a summary of the note. Try again.',
  not_submitted: 'The Wallet did not send the transaction.',
  submission_unknown: 'The transaction may have gone out. Check the explorer before you try again.',
};

const ENROLL_REFUSALS: Record<string, string> = {
  quality: 'A recording was too short or too quiet.',
  speaker: 'The three recordings do not sound like one speaker.',
  audio_reused: 'A recording was used before.',
  audio_invalid: 'The verifier could not read a recording.',
  unsupported: 'The verifier does not support this request.',
  speaker_unavailable: 'The speaker check service did not answer.',
  storage: 'The verifier could not store the template.',
  template_exists: 'Another enrollment changed the template at the same time.',
  not_authorized: 'The signed message is not from a full-access key of this account.',
  authorization_unavailable: 'The verifier could not read the access keys of this account.',
};

/** The text of an `unavailable` result. A route timeout (`verifier_timeout`) names OutLayer. */
export function unavailableText(result: { reason: string; detail?: string }): string {
  if (result.reason === 'verifier_unavailable' && result.detail === 'verifier_timeout') {
    return 'OutLayer timed out: the verifier did not answer in time. Your recording is not the cause. Try again in a minute.';
  }
  return withDetail(UNAVAILABLE[result.reason] ?? `Not available (${result.reason}).`, result.detail);
}

function withDetail(text: string, detail: string | undefined): string {
  return detail ? `${text} ${detail}` : text;
}

export function errorText(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
