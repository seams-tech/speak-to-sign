// The scheduled request of the X posts snapshot. The route (demo/frontend/functions/api/x/
// eligible-posts.ts) decides whether to call X: it calls when the snapshot is about 8 hours old,
// and answers from the snapshot otherwise. This Worker only makes sure that a request comes.
// It sends no key: the route needs none from it, and it answers one post (limit=1).

export default {
  /** @param {unknown} _event @param {{ SITE_URL?: string }} env */
  async scheduled(_event, env) {
    const site = (env.SITE_URL || 'https://seams-voice-intents.pages.dev').replace(/\/+$/, '');
    // A new query each time, so that no cache answers in place of the route.
    const url = `${site}/api/x/eligible-posts?limit=1&at=${Date.now()}`;
    const response = await fetch(url, { headers: { Accept: 'application/json' } });
    const body = await response.json().catch(() => null);
    const total = body && typeof body.total === 'number' ? body.total : '?';
    const stale = body && typeof body.stale === 'boolean' ? body.stale : '?';
    console.log(`x-refresh: ${response.status}, ${total} posts kept, stale ${stale}`);
  },
};
