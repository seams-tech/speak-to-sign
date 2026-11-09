// The real signer: Seams Wallet Speak-to-Sign.
//
// requestNote and requestRating come with Seams Wallet SDK 0.59.0. This page calls them through
// a structural check, so it builds with SDK 0.58.1 too and then answers `unavailable` until the
// SDK and the Wallet host at `walletOrigin` have spoken notes.

import type { useSeams } from '@seams/wallet/react';
import type { NotesSigner, Rating, SetupOutcome, SignResult, SignerSetup, SignerStatus } from './notesSigner';

type Seams = ReturnType<typeof useSeams>['seams'];

/** The result shape of every spoken request in the SDK (`SpokenResult`). */
type SdkSpokenResult =
  | {
      kind: 'sent';
      transactionHash: string;
      approval?: 'voice' | 'voice_and_passkey';
      times?: { endOfSpeechToReceiptMs?: number };
    }
  | { kind: 'refused'; reason: string; detail?: string }
  | { kind: 'cancelled' }
  | { kind: 'unavailable'; reason: string; detail?: string };

/** `seams.speakToSign` of SDK 0.59.0: the note methods. */
type NoteCommands = {
  requestNote(request: { walletId: string; contract: string; postId: number; text: string; summary: string }): Promise<SdkSpokenResult>;
  requestRating(request: { walletId: string; contract: string; noteId: number; rating: Rating }): Promise<SdkSpokenResult>;
};

type SdkEnrollmentResult =
  | { kind: 'enrolled'; templateEpoch: number; agreementMilli: number }
  | { kind: 'refused'; reason: string; detail?: string }
  | { kind: 'cancelled' }
  | { kind: 'unavailable'; reason: string; detail?: string };

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

const NO_NOTES_IN_SDK =
  'This page runs Seams Wallet SDK 0.58.1, which has no spoken notes. Spoken notes need SDK 0.59.0.';

export function createSeamsSigner(owner: SeamsOwner): NotesSigner & SignerSetup {
  const { seams, walletId, nearAccountId, contract } = owner;

  const noteCommands = (): NoteCommands | null => {
    const candidate = seams.speakToSign as unknown as Partial<NoteCommands> | undefined;
    return candidate && typeof candidate.requestNote === 'function' && typeof candidate.requestRating === 'function'
      ? (candidate as NoteCommands)
      : null;
  };

  const run = async (call: (commands: NoteCommands, walletId: string) => Promise<SdkSpokenResult>): Promise<SignResult> => {
    if (!walletId) return { kind: 'unavailable', reason: 'Sign in to Seams Wallet first.' };
    const commands = noteCommands();
    if (!commands) return { kind: 'unavailable', reason: NO_NOTES_IN_SDK };
    try {
      return toSignResult(await call(commands, walletId));
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

    requestNote: ({ postId, text, summary }) =>
      run((commands, id) => commands.requestNote({ walletId: id, contract, postId, text, summary })),

    requestRating: ({ noteId, rating }) =>
      run((commands, id) => commands.requestRating({ walletId: id, contract, noteId, rating })),

    async enableVoice(): Promise<SetupOutcome> {
      if (!walletId) return { kind: 'failed', message: 'Sign in to Seams Wallet first.' };
      try {
        const availability = await seams.registration.getAuthMethodAvailability({ walletId, method: 'voiceid' });
        if (availability.kind === 'enabled') return { kind: 'done', message: 'VoiceID is on.' };
        if (availability.kind === 'disabled') {
          await seams.registration.setAuthMethodEnabled({ walletId, method: 'voiceid', enabled: true });
          return { kind: 'done', message: 'VoiceID is on again.' };
        }
        const result = await seams.registration.activateAuthMethod({ walletId, method: 'voiceid' });
        return result.kind === 'activated'
          ? { kind: 'done', message: 'VoiceID is on.' }
          : { kind: 'cancelled', message: 'You closed the VoiceID window. Nothing changed.' };
      } catch (cause) {
        return { kind: 'failed', message: errorText(cause) };
      }
    },

    async enroll(): Promise<SetupOutcome> {
      if (!walletId) return { kind: 'failed', message: 'Sign in to Seams Wallet first.' };
      const speakToSign = seams.speakToSign;
      if (!speakToSign) return { kind: 'failed', message: 'Speak-to-Sign is not in the Wallet configuration.' };
      try {
        const result = (await speakToSign.enroll({ walletId })) as SdkEnrollmentResult;
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
      } catch (cause) {
        return { kind: 'failed', message: errorText(cause) };
      }
    },
  };
}

function toSignResult(result: SdkSpokenResult): SignResult {
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
