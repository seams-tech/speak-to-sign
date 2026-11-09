// The seam between this page and the wallet that signs.
//
// The UI codes only against the types in this file. The mock signer
// (src/signer/mockBackend.ts) fills it today. The real Seams signer fills it
// later, in src/services.ts, with `seams.speakToSign.requestNote` and
// `seams.speakToSign.requestRating` from the Seams Wallet SDK 0.59.0.

export type Rating = 'helpful' | 'somewhat_helpful' | 'not_helpful';

export type SignResult =
  | { kind: 'sent'; transactionHash: string }
  | { kind: 'refused'; reason: string }
  | { kind: 'cancelled' }
  | { kind: 'unavailable'; reason: string };

export interface SignerStatus {
  signedIn: boolean;
  accountId?: string;
  voiceReady: boolean;
}

export interface NotesSigner {
  status(): Promise<SignerStatus>;
  /** The owner reads `summary` aloud. On accept, the Wallet signs `add_note`. */
  requestNote(input: { postId: number; text: string; summary: string }): Promise<SignResult>;
  /** The owner says the sentence for `rating`. On accept, the Wallet signs `rate_note`. */
  requestRating(input: { noteId: number; rating: Rating }): Promise<SignResult>;
}

/**
 * Optional setup steps. The setup panel shows a button for each method that
 * the signer has. A signer without these methods shows the steps as status only.
 */
export interface SignerSetup {
  signIn?(): Promise<void>;
  /** Turn on VoiceID in the Wallet. */
  enableVoice?(): Promise<void>;
  /** Record the owner's voice template. */
  enroll?(): Promise<void>;
}

/** The exact sentence that the owner says for each rating. */
export const RATING_SENTENCES: Record<Rating, string> = {
  helpful: 'this note is helpful',
  somewhat_helpful: 'this note is somewhat helpful',
  not_helpful: 'this note is not helpful',
};
