// Two real posts that got a Community Note on Twitter (now X). They show the kind of
// post that a note corrects.
// - The White House post is a work of the US government (public domain). It shows as posted.
// - The Pentagon post is re-created from news reports. Its account impersonated a news
//   outlet, so the page does not show that name. The picture is a drawing, not the fake image.
// The page does not invent reply, repost, like or view counts for these posts.

export type MediaKind = 'pentagon';

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
}

export interface PostHistory {
  /** One line on the timeline. */
  short: string;
  /** The full story on the post page. */
  detail: string;
  source: { title: string; url: string };
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
}

export const POSTS: Post[] = [
  {
    id: 1,
    author: {
      name: 'Impersonator account',
      handle: 'suspended',
      initials: '?',
      color: '#536471',
      kind: 'person',
      badge: 'blue',
      logo: 'unknown',
    },
    text: 'Large explosion near the Pentagon complex in Washington, D.C. Initial report.',
    media: 'pentagon',
    mediaCaption: 'AI-generated fake',
    age: 'May 22, 2023',
    postedAt: 'May 22, 2023',
    history: {
      short: 'Re-created from news reports · got a Community Note',
      detail:
        'Re-created from news reports of May 22, 2023. A paid-verified account that impersonated a news outlet posted an AI-generated picture of smoke near the Pentagon. Stocks dipped for a few minutes. The Arlington fire department said that there was no explosion, a Community Note said that the picture was fake, and the account was suspended.',
      source: {
        title: 'NPR: fake viral images of an explosion at the Pentagon were probably created by AI',
        url: 'https://www.wusf.org/2023-05-22/fake-viral-images-of-an-explosion-at-the-pentagon-were-probably-created-by-ai',
      },
    },
  },
  {
    id: 2,
    author: {
      name: 'The White House',
      handle: 'WhiteHouse',
      initials: 'WH',
      color: '#0b2a4a',
      kind: 'person',
      badge: 'gray',
      logo: 'government',
    },
    text: "Seniors are getting the biggest increase in their Social Security checks in 10 years through President Biden's leadership.",
    age: 'Nov 1, 2022',
    postedAt: 'Nov 1, 2022',
    history: {
      short: 'Real post · got a Community Note, then was deleted',
      detail:
        'Real post of Nov 1, 2022. A Community Note said that the increase was the yearly cost-of-living adjustment, which a 1972 law ties to inflation. The White House deleted the post the next day.',
      source: {
        title: 'WFAA Verify: the Social Security increase comes from a formula, not the President',
        url: 'https://www.wfaa.com/article/news/verify/social-security-verify/social-security-benefit-cola-increase-comes-from-formula-not-president-joe-biden/536-3d106c3d-048e-41d4-9ca2-a94848ee4837',
      },
    },
  },
];

export function findPost(id: number): Post | undefined {
  return POSTS.find((post) => post.id === id);
}
