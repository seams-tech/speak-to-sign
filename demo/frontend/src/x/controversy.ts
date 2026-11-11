// How disputed a post is, for the "Controversial" tab. Three signs, each from 0 to 1:
// - the replies against the likes of the post on X (a post with more replies than likes is
//   "ratioed");
// - how evenly the raters of its note are split between helpful and not helpful;
// - how close the pool of its market is to 50% yes.
// A post with no sign has the score 0, and the tab does not show it.

import type { Post } from '../data/posts';
import type { NoteMarket } from '../market/types';
import type { Note } from '../notes/types';

/** "1.2K" -> 1200. The timeline shows the counts of X in this short form. */
export function countOf(text: string | undefined): number {
  const match = /^([\d.,]+)\s*([KMB])?$/i.exec(text?.trim() ?? '');
  if (!match) return 0;
  const scale = { K: 1e3, M: 1e6, B: 1e9 }[(match[2] ?? '').toUpperCase()] ?? 1;
  const value = Number((match[1] ?? '').replace(/,/g, '')) * scale;
  return Number.isFinite(value) ? value : 0;
}

/** 1 when the two sides are equal, 0 when one side has all. */
function balance(a: number, b: number): number {
  return a + b === 0 ? 0 : 1 - Math.abs(a - b) / (a + b);
}

export function controversy(post: Post, note: Note | undefined, market: NoteMarket | null | undefined): number {
  const replies = countOf(post.stats?.replies);
  const likes = countOf(post.stats?.likes);
  // As many replies as likes counts as fully disputed.
  const ratio = replies + likes === 0 ? 0 : Math.min(1, replies / Math.max(1, likes));
  const ratings = note ? balance(note.helpful + note.somewhat_helpful / 2, note.not_helpful + note.somewhat_helpful / 2) : 0;
  const pool = market && market.status !== 'resolved' ? balance(Number(market.yesPool), Number(market.noPool)) : 0;
  return ratio + ratings + pool;
}
