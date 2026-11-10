// The posts from X that can get a note, as posts of the notes app. They come from the page's
// own route /api/x/eligible-posts (functions/api/x/eligible-posts.ts).

import type { Post } from '../data/posts';
import { FIXTURE_FETCHED_AT_MS, FIXTURE_POSTS } from './fixture.ts';
import type { XPost } from './types';

/**
 * The post id that the notes contract and the Seams Wallet use for a post from X.
 *
 * An X post id has 64 bits. The Wallet refuses a post id above 2^53 - 1 (the largest integer
 * that JavaScript holds exactly), so the id loses its lowest 10 bits. What stays is the post's
 * time in milliseconds, its X server and the top of its counter. Two posts get the same number
 * only if the same X server made them in the same millisecond. The result stays below 2^53
 * for every id below 2^63, which X reaches in about 2079.
 */
export function notePostId(xPostId: string): number {
  return Number(BigInt(xPostId) >> 10n);
}

/** "5m", "3h" or "2d", as X shows the age of a post. */
export function ageText(createdAt: string | null, nowMs: number): string {
  if (!createdAt) return '';
  const minutes = Math.max(1, Math.round((nowMs - Date.parse(createdAt)) / 60_000));
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 24 * 60) return `${Math.round(minutes / 60)}h`;
  return `${Math.round(minutes / (24 * 60))}d`;
}

/** "2.6K", "120K" or "3.2M". */
export function compactCount(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(count >= 10_000 ? 0 : 1).replace(/\.0$/, '')}K`;
  return String(count);
}

export function toPost(x: XPost, nowMs: number): Post {
  const name = x.author?.name ?? 'X user';
  const photo = x.media[0];
  const post: Post = {
    id: notePostId(x.id),
    author: {
      name,
      handle: x.author?.username ?? 'unknown',
      initials: (name.match(/[\p{L}\p{N}]/u)?.[0] ?? '?').toUpperCase(),
      color: '#536471',
      kind: 'person',
    },
    text: x.text,
    linkify: true,
    age: ageText(x.createdAt, nowMs),
    postedAt: x.createdAt
      ? new Date(x.createdAt).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
      : 'On X',
    history: {
      short: 'From X · readers asked for a note',
      detail: 'A post from X. Readers on X asked for a Community Note on it.',
      source: { title: 'The post on X', url: x.url },
    },
  };
  if (x.author?.avatarUrl) post.author.avatarUrl = x.author.avatarUrl;
  if (x.author?.verified) post.author.badge = 'blue';
  if (photo) post.image = { url: photo.url, alt: photo.alt ?? '' };
  if (x.topic) post.topic = x.topic;
  if (x.metrics) {
    post.stats = {
      replies: compactCount(x.metrics.replies),
      reposts: compactCount(x.metrics.reposts),
      likes: compactCount(x.metrics.likes),
      bookmarks: '',
      views: compactCount(x.metrics.views),
    };
  }
  return post;
}

/** The body of the route as posts, or null when it does not have the shape. */
export function readXPosts(body: unknown, nowMs: number): Post[] | null {
  if (typeof body !== 'object' || body === null || !Array.isArray((body as { posts?: unknown }).posts)) return null;
  const posts = (body as { posts: XPost[] }).posts;
  const seen = new Set<number>();
  return posts.flatMap((x) => {
    if (typeof x?.id !== 'string' || !/^\d{1,20}$/.test(x.id) || typeof x.text !== 'string' || !Array.isArray(x.media)) return [];
    const post = toPost(x, nowMs);
    if (seen.has(post.id)) return [];
    seen.add(post.id);
    return [post];
  });
}

/**
 * The posts from the route, or null when the route gives none. `pnpm dev` without the function
 * server shows the five example posts of fixture.ts, so the timeline can be seen without X.
 */
export async function loadXPosts(): Promise<Post[] | null> {
  try {
    const response = await fetch('/api/x/eligible-posts', { headers: { Accept: 'application/json' } });
    if (response.ok) {
      const posts = readXPosts(await response.json(), Date.now());
      if (posts) return posts;
    }
  } catch {
    // The fallback below.
  }
  return import.meta.env.DEV ? FIXTURE_POSTS.map((x) => toPost(x, FIXTURE_FETCHED_AT_MS)) : null;
}
