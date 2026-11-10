import { useSyncExternalStore } from 'react';
import { POSTS } from './data/posts';

/** The post that the demo opens on. */
export const START_POST_ID = POSTS[0]?.id ?? 1;

// The notes app lives in the Speak-to-Sign page, under the hash #/notes. The page opens the
// notes window when the hash starts with #/notes, and closes it when the hash goes.
// A hash shows a post: #/notes/post/<id>, or the demo post. #/notes/timeline shows the list of
// posts: the demo post and the posts from X that can get a note.

export type HomeTab = 'for_you' | 'needs_help';
export type Route = { name: 'home'; tab: HomeTab } | { name: 'timeline' } | { name: 'post'; postId: number };

function subscribe(onChange: () => void) {
  window.addEventListener('hashchange', onChange);
  return () => window.removeEventListener('hashchange', onChange);
}

function parse(hash: string): Route {
  const post = /^#\/notes\/post\/(\d+)/.exec(hash);
  if (post) return { name: 'post', postId: Number(post[1]) };
  if (/^#\/notes\/timeline\b/.test(hash)) return { name: 'timeline' };
  return { name: 'post', postId: START_POST_ID };
}

export function useRoute(): Route {
  return parse(useSyncExternalStore(subscribe, () => window.location.hash));
}

/** A key that changes when the page changes, to scroll back to the top. */
export function routeKey(route: Route): string {
  if (route.name === 'timeline') return 'timeline';
  return route.name === 'post' ? `post:${route.postId}` : `home:${route.tab}`;
}

export const paths = {
  home: '#/notes',
  needsHelp: '#/notes/needs-help',
  timeline: '#/notes/timeline',
  post: (postId: number) => `#/notes/post/${postId}`,
};

export function navigate(path: string) {
  window.location.hash = path;
}
