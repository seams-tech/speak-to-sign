// The seam between this page and the wallet that signs.
//
// The UI codes only against the types in this file. src/signer/seamsSigner.ts fills it with
// the Seams Wallet: `seams.near.spoken.note`, `spoken.rating` and `spoken.enroll`.

export type Rating = 'helpful' | 'somewhat_helpful' | 'not_helpful';

export type SignResult =
  | {
      kind: 'sent';
      transactionHash: string;
      /** `voice_and_passkey` when a policy rule asked for a passkey after the voice. */
      approval?: 'voice' | 'voice_and_passkey';
      /** Milliseconds from the end of speech to the transaction receipt. */
      endOfSpeechToReceiptMs?: number;
    }
  | { kind: 'refused'; reason: string }
  | { kind: 'cancelled' }
  | { kind: 'unavailable'; reason: string };

export interface SignerStatus {
  signedIn: boolean;
  accountId?: string;
  /** VoiceID is on for the wallet. The verifier template is a separate step (enroll). */
  voiceReady: boolean;
}

export interface NotesSigner {
  status(): Promise<SignerStatus>;
  /**
   * The Seams server writes a short summary of `text`, and the owner reads it aloud from the
   * Wallet card. On accept, the Wallet signs `add_note`.
   */
  requestNote(input: { postId: number; text: string }): Promise<SignResult>;
  /**
   * Tells the Wallet that a note with this text comes soon: the Wallet loads its Speak-to-Sign
   * code and asks the Seams server for the summary now, so the card of `requestNote` shows
   * sooner. It shows nothing and signs nothing. A signer with no such step leaves it out.
   */
  prepareNote?(text: string): void;
  /** The owner says the sentence for `rating`. On accept, the Wallet signs `rate_note`. */
  requestRating(input: { noteId: number; rating: Rating }): Promise<SignResult>;
}

/** The result of one setup step, in plain words. */
export type SetupOutcome = { kind: 'done' | 'cancelled' | 'failed'; message: string };

/** The Wallet setup steps after sign-in. Sign-in itself is the Wallet's own menu. */
export interface SignerSetup {
  /** Turns VoiceID on again if the owner turned it off. A new wallet gets VoiceID in `enroll`. */
  enableVoice(): Promise<SetupOutcome>;
  /**
   * Records three phrases and stores the owner's voice template at the verifier. A wallet
   * without VoiceID gets it here from the same three recordings.
   */
  enroll(): Promise<SetupOutcome>;
}

/** The exact sentence that the owner says for each rating. */
export const RATING_SENTENCES: Record<Rating, string> = {
  helpful: 'this note is helpful',
  somewhat_helpful: 'this note is somewhat helpful',
  not_helpful: 'this note is not helpful',
};
