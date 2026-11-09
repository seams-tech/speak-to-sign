// The text that JEV reads for a market on a note: the post and the note. The contract freezes
// it when the market opens, so later edits do not count.

import { findPost } from '../data/posts';
import type { Note } from '../notes/types';

const MAX_CONTEXT_CHARS = 1_000;

export function marketContext(note: Note): string {
  const post = findPost(note.post_id);
  const text = [post ? `Post by ${post.author.name}: ${post.text}` : `Post ${note.post_id}.`, `Community note: ${note.text}`].join('\n\n');
  return [...text].slice(0, MAX_CONTEXT_CHARS).join('');
}
