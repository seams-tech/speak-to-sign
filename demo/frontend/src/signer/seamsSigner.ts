// The real signer: Seams Wallet Speak-to-Sign (SDK 0.59.0).
//
// requestNote and requestRating run one spoken request in the Wallet iframe: the owner says the
// summary or the rating sentence, the verifier checks the voice and the words, and the Wallet
// signs `add_note` or `rate_note` on the notes contract from the owner's own account.

import { summaryRefusal, type SpeakToSignEnrollmentResult, type SpeakToSignNoteResult } from '@seams/wallet';
import type { useSeams } from '@seams/wallet/react';
import type { NotesSigner, SetupOutcome, SignResult, SignerSetup, SignerStatus } from './notesSigner';

type Seams = ReturnType<typeof useSeams>['seams'];
type SpeakToSign = NonNullable<Seams['speakToSign']>;

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

  const run = async (call: (speakToSign: SpeakToSign, walletId: string) => Promise<SpeakToSignNoteResult>): Promise<SignResult> => {
    if (!walletId) return { kind: 'unavailable', reason: 'Sign in to Seams Wallet first.' };
    const speakToSign = seams.speakToSign;
    if (!speakToSign) return { kind: 'unavailable', reason: 'Speak-to-Sign is not in the Wallet configuration.' };
    try {
      return toSignResult(await call(speakToSign, walletId));
    } catch (cause) {
      return { kind: 'unavailable', reason: `The Wallet stopped with an error: ${errorText(cause)}` };
    }
  };

  return {
    async status(): Promise<SignerStatus> {
      if (!walletId) return { signedIn: false, voiceReady: false };
      const availability = await seams.registration.getAuthMethodAvailability({ walletId, method: 'voiceid' });
      return { signedIn: true, accountId: nearAccountId ?? undefined, voiceReady: availability.kind === 'enabled' };
    },

    requestNote: async ({ postId, text, summary }) => {
      // The Wallet refuses a summary that breaks the SDK's rule, so check it first.
      if (summaryRefusal(summary) !== null) return { kind: 'refused', reason: REFUSALS.summary_not_speakable ?? 'The summary is not speakable.' };
      return await run((speakToSign, id) => speakToSign.requestNote({ walletId: id, contract, postId, text, summary }));
    },

    requestRating: ({ noteId, rating }) =>
      run((speakToSign, id) => speakToSign.requestRating({ walletId: id, contract, noteId, rating })),

    async enableVoice(): Promise<SetupOutcome> {
      if (!walletId) return { kind: 'failed', message: 'Sign in to Seams Wallet first.' };
      const id = walletId;
      return await withFreshUnlock(seams, id, async () => {
        const availability = await seams.registration.getAuthMethodAvailability({ walletId: id, method: 'voiceid' });
        if (availability.kind === 'enabled') return { kind: 'done', message: 'VoiceID is on.' };
        if (availability.kind === 'disabled') {
          await seams.registration.setAuthMethodEnabled({ walletId: id, method: 'voiceid', enabled: true });
          return { kind: 'done', message: 'VoiceID is on again.' };
        }
        const result = await seams.registration.activateAuthMethod({ walletId: id, method: 'voiceid' });
        return result.kind === 'activated'
          ? { kind: 'done', message: 'VoiceID is on.' }
          : { kind: 'cancelled', message: 'You closed the VoiceID window. Nothing changed.' };
      });
    },

    async enroll(): Promise<SetupOutcome> {
      if (!walletId) return { kind: 'failed', message: 'Sign in to Seams Wallet first.' };
      const id = walletId;
      const speakToSign = seams.speakToSign;
      if (!speakToSign) return { kind: 'failed', message: 'Speak-to-Sign is not in the Wallet configuration.' };
      return await withFreshUnlock(seams, id, () => enrollOnce(speakToSign, id));
    },
  };
}

/**
 * Runs a setup step. Some steps need the wallet's custody seed, which the Wallet keeps in
 * memory only after a passkey unlock in the same Wallet session (a session restored after a
 * page reload does not have it). If the Wallet asks for that, unlock with the passkey once and
 * run the step again.
 */
async function withFreshUnlock(seams: Seams, walletId: string, step: () => Promise<SetupOutcome>): Promise<SetupOutcome> {
  try {
    return await step();
  } catch (cause) {
    if (!NEEDS_UNLOCK.test(errorText(cause))) return { kind: 'failed', message: errorText(cause) };
  }
  try {
    const unlock = await seams.auth.unlock(walletId);
    if (!unlock.success) {
      return { kind: 'failed', message: `The Wallet needs a passkey unlock first, and the unlock did not finish. ${unlock.error}` };
    }
    return await step();
  } catch (cause) {
    return { kind: 'failed', message: errorText(cause) };
  }
}

/** The Wallet's messages that ask for a fresh owner unlock. */
const NEEDS_UNLOCK = /unlock (the|this) wallet|custody seed|requires an active owner wallet session/i;

/** One verifier enrollment. A thrown error goes to withFreshUnlock. */
async function enrollOnce(speakToSign: SpeakToSign, walletId: string): Promise<SetupOutcome> {
  const result: SpeakToSignEnrollmentResult = await speakToSign.enroll({ walletId });
  switch (result.kind) {
    case 'enrolled':
      return { kind: 'done', message: `The verifier stored your voice (template ${result.templateEpoch}).` };
    case 'refused':
      return { kind: 'failed', message: withDetail(ENROLL_REFUSALS[result.reason] ?? `The verifier refused (${result.reason}).`, result.detail) };
    case 'cancelled':
      return { kind: 'cancelled', message: 'You closed a Wallet window. Nothing was enrolled.' };
    case 'unavailable':
      return { kind: 'failed', message: withDetail(UNAVAILABLE[result.reason] ?? `Not available (${result.reason}).`, result.detail) };
  }
}

function toSignResult(result: SpeakToSignNoteResult): SignResult {
  switch (result.kind) {
    case 'sent':
      return {
        kind: 'sent',
        transactionHash: result.transactionHash,
        approval: result.approval,
        endOfSpeechToReceiptMs: result.times?.endOfSpeechToReceiptMs,
      };
    case 'refused':
      return { kind: 'refused', reason: withDetail(REFUSALS[result.reason] ?? `The Wallet refused (${result.reason}).`, result.detail) };
    case 'cancelled':
      return { kind: 'cancelled' };
    case 'unavailable':
      return { kind: 'unavailable', reason: withDetail(UNAVAILABLE[result.reason] ?? `Not available (${result.reason}).`, result.detail) };
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
  summary_not_speakable: 'The summary must be 1 to 12 words of letters A to Z.',
  note_not_valid: 'The note, the contract or the id is not valid.',
  verdict_mismatch: 'The signed verdict did not match this request, so the Wallet signed nothing.',
  transaction_failed: 'The transaction failed on chain.',
  // SDK 0.60.0: the Seams co-signer refused the verdict. `detail` holds its reason.
  voice_limit: 'This payment is over the voice limit.',
  cosigner_refused: 'Seams did not accept the verdict, so nothing was signed.',
};

const UNAVAILABLE: Record<string, string> = {
  flow_not_available: 'The Seams Wallet on this server has no spoken notes yet.',
  voiceid_unavailable: 'VoiceID is not on for this wallet. Turn it on in the setup steps.',
  verifier_unavailable: 'The Speak-to-Sign verifier did not answer.',
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

function withDetail(text: string, detail: string | undefined): string {
  return detail ? `${text} ${detail}` : text;
}

function errorText(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
