import { useSyncExternalStore } from 'react';
import { POSTS } from './data/posts';

/** The post that the demo opens on. */
export const START_POST_ID = POSTS[0]?.id ?? 1;

// The notes app lives in the Speak-to-Sign page, under the hash #/notes. The page opens the
// notes window when the hash starts with #/notes, and closes it when the hash goes.
// The app has one page: the post. Every hash shows a post: #/notes/post/<id>, or the demo post.

export type HomeTab = 'for_you' | 'needs_help';
export type Route = { name: 'home'; tab: HomeTab } | { name: 'post'; postId: number };

function subscribe(onChange: () => void) {
  window.addEventListener('hashchange', onChange);
  return () => window.removeEventListener('hashchange', onChange);
}

function parse(hash: string): Route {
  const post = /^#\/notes\/post\/(\d+)/.exec(hash);
  if (post) return { name: 'post', postId: Number(post[1]) };
  return { name: 'post', postId: START_POST_ID };
}

export function useRoute(): Route {
  return parse(useSyncExternalStore(subscribe, () => window.location.hash));
}

/** A key that changes when the page changes, to scroll back to the top. */
export function routeKey(route: Route): string {
  return route.name === 'post' ? `post:${route.postId}` : `home:${route.tab}`;
}

export const paths = {
  home: '#/notes',
  needsHelp: '#/notes/needs-help',
  post: (postId: number) => `#/notes/post/${postId}`,
};

export function navigate(path: string) {
  window.location.hash = path;
}
