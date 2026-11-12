import { createContext, useContext } from 'react';
import type { FundsNeed } from './faucet/funds';
import type { Post } from './data/posts';
import type { Note, NotesStore } from './notes/types';
import type { NotesSigner, Rating, SignerSetup, SignerStatus } from './signer/notesSigner';

/** A step that `prepare` runs before an action: sign in, set up the voice, testnet funds. */
export type PrepareStep = 'signin' | 'voice' | 'funds';

/** What an action needs before it can run. Sign-in is always part of it. */
export interface PrepareNeeds {
  funds?: FundsNeed;
  voice?: boolean;
}

/**
 * `ok`: the account is ready, and `signer` is the signer of that account (the one in a closure
 * from before the sign-in is out of date). Not `ok`: the visitor stopped, or `reason` says why
 * `step` failed.
 */
export type Prepared =
  | { ok: true; account: string; signer: NotesSigner & SignerSetup }
  | { ok: false; reason?: string; step?: PrepareStep };

export interface DemoState {
  signer: NotesSigner & SignerSetup;
  /** False when the build has no Seams publishable key. */
  walletConfigured: boolean;
  store: NotesStore;
  status: SignerStatus | null;
  /** The signed-in NEAR account, if any. */
  account: string | undefined;
  notesByPost: Record<number, Note[]>;
  /** The posts from X that can get a note (src/x/xPosts.ts), newest first. */
  xPosts: Post[];
  /** `error`: the posts service gave no posts. The timeline then shows none. */
  xPostsState: 'loading' | 'ready' | 'error';
  /** The route has more posts than the timeline loaded. */
  xPostsMore: boolean;
  /** `loading`: the next page is on its way. `error`: the last try failed. */
  xPostsMoreState: 'idle' | 'loading' | 'error';
  /** Loads the next page of posts from X. Calls while a page loads do nothing. */
  loadMoreXPosts(): void;
  loading: boolean;
  loadError: string | null;
  /** The ratings of the signed-in account, by note id. */
  myRatings: Record<number, Rating>;
  /** The `add_note` transaction of each note sent in this session, by note id. */
  noteTx: Record<number, string>;
  /** The `rate_note` transaction of the signed-in account, by note id. */
  ratingTx: Record<number, string>;
  /** The note that this visitor posted last, while the page shows it as new. */
  freshNoteId: number | null;
  /** The step that `prepare` runs now, if any. */
  preparing: PrepareStep | null;
  /** `autoSign`: the spoken step starts by itself (a voice command asked for the note). */
  openWrite(postId: number, options?: { autoSign?: boolean }): void;
  /** `rating` with `autoSign`: the dialog opens with this answer, and the spoken step starts by itself. */
  openRate(noteId: number, options?: { rating?: Rating; autoSign?: boolean }): void;
  /** Opens the sign-in. Resolves with the account, or null when the visitor closes it. */
  openSignIn(): Promise<string | null>;
  /** True while the sign-in is open. */
  signingIn: boolean;
  /**
   * An open dialog shows the sign-in as one of its own steps (SignInStep), so no second dialog
   * opens on top. Call it on mount; the result unregisters. A host that closes cancels the sign-in.
   */
  hostSignIn(): () => void;
  /** A hosted sign-in ended: signed in, or not (Back, or the Wallet's cancel). */
  endSignIn(signedIn: boolean): void;
  /**
   * Runs the steps that an action still needs, in order: sign in, set up the voice, testnet
   * funds (the faucet). A step that is done already is skipped, so a set-up visitor sees nothing.
   */
  prepare(needs: PrepareNeeds, onStep?: (step: PrepareStep) => void): Promise<Prepared>;
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
