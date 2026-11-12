// The posts of the timeline. They all come from X at run time (src/x/xPosts.ts), and the app
// registers them here, so that every lookup by id finds them: the write dialog, the voice feed,
// "Your bets" and the text that JEV reads. The page does not invent reply, repost, like or view
// counts.

export interface PostAuthor {
  name: string;
  handle: string;
  /** The text in the avatar. */
  initials: string;
  color: string;
  /** Organizations have a square avatar. */
  kind: 'organization' | 'person';
  /** The check mark: gold for an organization, gray for a government account, blue for a paid account. */
  badge?: 'gold' | 'gray' | 'blue';
  /** The profile picture of a post from X. It replaces the initials. */
  avatarUrl?: string;
}

export interface PostHistory {
  /** One line on the timeline. */
  short: string;
  /** The full story on the post page. */
  detail: string;
  source: { title: string; url: string };
}

/** A note that the write dialog starts with, so a demo needs no typing. Every field can change. */
export interface NoteDraft {
  classification: 'misleading' | 'not_misleading';
  reasons: string[];
  /** At most 280 characters, with a link to a source. */
  text: string;
  sources: 'yes' | 'no';
  /** True when a NEAR AI model wrote the text (not a template): the write dialog says so. */
  byNearAi?: boolean;
}

export interface Post {
  id: number;
  author: PostAuthor;
  text: string;
  link?: string;
  /** The time on the timeline, for example "May 22, 2023". */
  age: string;
  /** The time on the post page. */
  postedAt: string;
  /** The counts on the action row, from X. A post without them shows none. */
  stats?: { replies: string; reposts: string; likes: string; bookmarks: string; views: string };
  history: PostHistory;
  noteDraft?: NoteDraft;
  /** A post from X (src/x/xPosts.ts): its photo, its subject, and links in its text. */
  image?: { url: string; alt: string };
  topic?: string;
  linkify?: boolean;
}

const registered = new Map<number, Post>();

/** Adds posts that arrived at run time. */
export function registerPosts(posts: Post[]): void {
  for (const post of posts) registered.set(post.id, post);
}

export function findPost(id: number): Post | undefined {
  return registered.get(id);
}
