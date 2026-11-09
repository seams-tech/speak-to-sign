// Fictional posts. No real people, accounts or brands.

export type MediaKind = 'bridge' | 'heat' | 'panda';

export interface PostAuthor {
  name: string;
  handle: string;
  /** The text in the avatar. */
  initials: string;
  color: string;
  /** Organizations have a square avatar and a gold badge. */
  kind: 'organization' | 'person';
  /** A logo in place of the initials. */
  logo?: 'metro' | 'weather' | 'zoo';
}

export interface Post {
  id: number;
  author: PostAuthor;
  text: string;
  link?: string;
  media?: MediaKind;
  /** The time on the timeline, for example "2h". */
  age: string;
  /** The time on the post page. */
  postedAt: string;
  stats: { replies: string; reposts: string; likes: string; bookmarks: string; views: string };
}

export const POSTS: Post[] = [
  {
    id: 1,
    author: { name: 'Metro Daily', handle: 'metrodaily', initials: 'METRO', color: '#0f1419', kind: 'organization', logo: 'metro' },
    text: 'Harbor Bridge will close for six months from Monday. Plan another route.',
    link: 'metro.news/hb-close',
    media: 'bridge',
    age: '2h',
    postedAt: '3:42 PM · Nov 9, 2026',
    stats: { replies: '312', reposts: '1.1K', likes: '4.8K', bookmarks: '210', views: '1.2M' },
  },
  {
    id: 2,
    author: { name: 'Northfield Weather Desk', handle: 'northfieldwx', initials: 'NWD', color: '#ea580c', kind: 'organization', logo: 'weather' },
    text: 'Saturday will reach 41°C in Northfield, the hottest day on record here. Stay indoors from noon.',
    media: 'heat',
    age: '8h',
    postedAt: '9:15 AM · Nov 9, 2026',
    stats: { replies: '98', reposts: '640', likes: '2.2K', bookmarks: '75', views: '486K' },
  },
  {
    id: 3,
    author: { name: 'Orbit Fan Jo', handle: 'orbitfan_jo', initials: 'OJ', color: '#7c3aed', kind: 'person' },
    text: 'The new Orbit 9 phone lasts five days on one charge. Best battery ever made.',
    age: '21h',
    postedAt: '6:02 PM · Nov 8, 2026',
    stats: { replies: '41', reposts: '120', likes: '903', bookmarks: '18', views: '92K' },
  },
  {
    id: 4,
    author: { name: 'Lakeport City Zoo', handle: 'lakeportzoo', initials: 'ZOO', color: '#15803d', kind: 'organization', logo: 'zoo' },
    text: 'Meet Pip and Poppy, our new red panda twins. Come and say hello from Friday.',
    media: 'panda',
    age: '6h',
    postedAt: '11:30 AM · Nov 9, 2026',
    stats: { replies: '56', reposts: '890', likes: '12K', bookmarks: '340', views: '230K' },
  },
  {
    id: 5,
    author: { name: 'Trail Mix Runner', handle: 'trailmixrunner', initials: 'TM', color: '#0369a1', kind: 'person' },
    text: 'New study: eight cups of coffee a day make you run twice as fast. The science is clear.',
    age: '35m',
    postedAt: '4:48 PM · Nov 9, 2026',
    stats: { replies: '27', reposts: '64', likes: '310', bookmarks: '9', views: '18K' },
  },
];

export function findPost(id: number): Post | undefined {
  return POSTS.find((post) => post.id === id);
}
