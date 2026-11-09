// Notes as the notes contract (demo/contracts/community-notes/) returns them from
// `get_notes({ post_id })`. Ids are JSON numbers.

import type { Rating } from '../signer/notesSigner';

export type { Rating };

/** The contract rule: a note needs 2 ratings of one kind to get a status. */
export const MIN_RATINGS_FOR_STATUS = 2;

export type NoteStatus = 'helpful' | 'not_helpful' | 'needs_more_ratings';

export interface Note {
  id: number;
  post_id: number;
  author: string;
  text: string;
  summary: string;
  created_at_ms: number;
  helpful: number;
  somewhat_helpful: number;
  not_helpful: number;
  status: NoteStatus;
}

export interface NotesStore {
  /** The notes on a post, newest first. */
  getNotes(postId: number): Promise<Note[]>;
  /** The rating that an account gave to a note, if any. */
  getRating(noteId: number, accountId: string): Promise<Rating | null>;
}
