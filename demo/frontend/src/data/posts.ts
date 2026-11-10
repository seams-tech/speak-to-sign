// A real case that got a Community Note on X in 2026. It shows the kind of post that a note
// corrects. Posts here stay away from politics.
// - The post is re-created from news reports. Its account farms engagement, so the page does
//   not show its name or handle. The picture is a drawing of the claim, not the original video.
// The page does not invent reply, repost, like or view counts.

export type MediaKind = 'thumbnails';

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
  /** An icon in place of the initials. */
  logo?: 'government' | 'unknown';
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

/**
 * The Community Note that the post got on X, in our own words, without the account's name or
 * links. The post page shows it as "Readers added context", and its bet question opens the note
 * market.
 */
export interface PostContext {
  text: string;
  /** Short lines under the text, for example other posts of the same account. */
  examples: string[];
  /** The day the note became "Currently rated helpful", for example "Oct 29". */
  ratedHelpfulOn: string;
  /** What raters said about the note. */
  tags: string[];
}

/** A note that the write dialog starts with, so a demo needs no typing. Every field can change. */
export interface NoteDraft {
  classification: 'misleading' | 'not_misleading';
  reasons: string[];
  /** At most 280 characters, with a link to a source. */
  text: string;
  sources: 'yes' | 'no';
  /** The spoken summary: 1 to 12 words of ASCII letters (src/summaryRules.ts). */
  summary: string;
}

export interface Post {
  id: number;
  author: PostAuthor;
  text: string;
  link?: string;
  media?: MediaKind;
  /** A label on the picture. */
  mediaCaption?: string;
  /** The time on the timeline, for example "May 22, 2023". */
  age: string;
  /** The time on the post page. */
  postedAt: string;
  /** The counts on the action row. Real posts have none here: the page does not invent them. */
  stats?: { replies: string; reposts: string; likes: string; bookmarks: string; views: string };
  history: PostHistory;
  context?: PostContext;
  noteDraft?: NoteDraft;
  /** A post from X (src/x/xPosts.ts): its photo, its subject, and links in its text. */
  image?: { url: string; alt: string };
  topic?: string;
  linkify?: boolean;
}

export const POSTS: Post[] = [
  {
    id: 1,
    author: {
      name: 'Engagement account',
      handle: 'hidden',
      initials: '?',
      color: '#536471',
      kind: 'person',
      logo: 'unknown',
    },
    text: 'Claude Code just found 145,763 photos I deleted from my iPhone. Three years of them, still sitting in PhotoData/Thumbnails, with my passport and a screenshot of my crypto recovery phrase.',
    media: 'thumbnails',
    age: 'Oct 24',
    postedAt: 'Oct 24, 2026',
    history: {
      short: 'Re-created from news reports · got a Community Note',
      detail:
        'Re-created from news reports of Oct 24, 2026. The post reached about 4.1 million views, and copies on other accounts gave other numbers. A Community Note said that the account posts AI-written text every day to farm engagement, with different numbers each time. Thumbnails can outlive deleted photos, but the claims that any app can read them, that they are full size and that Apple never removes them have no support, and the attached video did not show the search.',
      source: {
        title: 'Fact-check: the viral post on deleted iPhone photos and Claude Code falls apart',
        url: 'https://pasqualepillitteri.it/en/news/28147/deleted-iphone-photos-claude-code-viral-post',
      },
    },
    context: {
      text: 'The author posts AI-generated engagement bait every day, with random claims about deleted photos or videos.',
      examples: [
        'Another post from the same account says that Claude Code found 12,847 photos of the author’s face.',
        'Another says that it found 214,856 deleted photos and videos.',
      ],
      ratedHelpfulOn: 'Oct 29',
      tags: ['Easy to understand', 'Provides important context'],
    },
    noteDraft: {
      classification: 'misleading',
      reasons: ['It presents an unverified claim as a fact'],
      text: 'This account posts AI-written engagement bait daily, with new numbers each time. Thumbnails can outlive deleted photos, but nothing shows they keep full photos, and the video shows no search. https://pasqualepillitteri.it/en/news/28147/deleted-iphone-photos-claude-code-viral-post',
      sources: 'yes',
      summary: 'this post is engagement bait and its photo claim has no proof',
    },
  },
];

// The posts from X arrive at run time (src/x/xPosts.ts). The app registers them here, so that
// every lookup by id finds them: the post page, the write dialog and the text that JEV reads.
const registered = new Map<number, Post>();

/** Adds posts that arrived at run time. A post of POSTS keeps its id. */
export function registerPosts(posts: Post[]): void {
  for (const post of posts) {
    if (!POSTS.some((fixed) => fixed.id === post.id)) registered.set(post.id, post);
  }
}

export function findPost(id: number): Post | undefined {
  return POSTS.find((post) => post.id === id) ?? registered.get(id);
}
