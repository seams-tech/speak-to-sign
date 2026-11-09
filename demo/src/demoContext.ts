import { createContext, useContext } from 'react';
import type { Note, NotesStore } from './notes/types';
import type { NotesSigner, Rating, SignerSetup, SignerStatus } from './signer/notesSigner';

export interface DemoState {
  signer: NotesSigner & SignerSetup;
  /** False when the build has no Seams publishable key. */
  walletConfigured: boolean;
  store: NotesStore;
  status: SignerStatus | null;
  /** The signed-in NEAR account, if any. */
  account: string | undefined;
  notesByPost: Record<number, Note[]>;
  loading: boolean;
  loadError: string | null;
  /** The ratings of the signed-in account, by note id. */
  myRatings: Record<number, Rating>;
  /** The `add_note` transaction of each note sent in this session, by note id. */
  noteTx: Record<number, string>;
  /** The `rate_note` transaction of the signed-in account, by note id. */
  ratingTx: Record<number, string>;
  openWrite(postId: number): void;
  openRate(noteId: number): void;
  openSignIn(): void;
  reload(): void;
}

export const DemoContext = createContext<DemoState | null>(null);

export function useDemo(): DemoState {
  const state = useContext(DemoContext);
  if (!state) throw new Error('useDemo needs <DemoContext.Provider>.');
  return state;
}

export const RATING_LABELS: Record<Rating, string> = {
  helpful: 'Helpful',
  somewhat_helpful: 'Somewhat helpful',
  not_helpful: 'Not helpful',
};
