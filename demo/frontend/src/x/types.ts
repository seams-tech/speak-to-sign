// The shape of a post from /api/x/eligible-posts. The route and the page share it.

import type { Topic } from '../../functions/lib/topicFilter.ts';

export interface XAuthor {
  id: string;
  username: string;
  name: string;
  avatarUrl: string | null;
  verified: boolean;
}

export interface XMedia {
  type: 'photo' | 'video' | 'animated_gif';
  /** A still image: the photo, or the preview of a video. */
  url: string;
  alt: string | null;
}

export interface XPost {
  id: string;
  text: string;
  createdAt: string | null;
  lang: string | null;
  url: string;
  author: XAuthor | null;
  media: XMedia[];
  metrics: { likes: number; reposts: number; replies: number; views: number } | null;
  /** The subject from the filter. Null when the filter is off. */
  topic: Topic | null;
}
