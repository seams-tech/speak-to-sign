import { useEffect, useSyncExternalStore } from 'react';

export type HomeTab = 'for_you' | 'needs_help';
export type Route = { name: 'home'; tab: HomeTab } | { name: 'post'; postId: number };

function subscribe(onChange: () => void) {
  window.addEventListener('hashchange', onChange);
  return () => window.removeEventListener('hashchange', onChange);
}

function parse(hash: string): Route {
  const post = /^#\/post\/(\d+)/.exec(hash);
  if (post) return { name: 'post', postId: Number(post[1]) };
  if (hash.startsWith('#/needs-help')) return { name: 'home', tab: 'needs_help' };
  return { name: 'home', tab: 'for_you' };
}

export function useRoute(): Route {
  const hash = useSyncExternalStore(subscribe, () => window.location.hash);
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [hash]);
  return parse(hash);
}

export const paths = {
  home: '#/',
  needsHelp: '#/needs-help',
  post: (postId: number) => `#/post/${postId}`,
};

export function navigate(path: string) {
  window.location.hash = path;
}
