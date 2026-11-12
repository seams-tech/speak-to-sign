# X posts refresh (scheduled Worker)

The Community Notes timeline shows posts from X that can get a note. The route
`/api/x/eligible-posts` (`../frontend/functions/api/x/eligible-posts.ts`) keeps
one snapshot of them in KV and asks X for 10 new posts when the snapshot is
about 8 hours old. Cloudflare Pages Functions have no schedule, so without
visitors the route never asks. This Worker sends one request to the route at
00:00, 08:00 and 16:00 UTC. With 20 posts each time (`X_ELIGIBLE_MAX` in the
site's `wrangler.toml`), the snapshot can grow by up to 120 posts in two days.
A post that X gives again counts once, and the subject filter leaves out some
posts, so a call adds fewer than 20.

The Worker sends no key and the route needs none from it: the route makes the
call to X only when the snapshot is old, so extra requests cost nothing.

## Deploy

Deploy it only with the owner's approval. It is a new Worker in the
Cloudflare account of the site:

```bash
cd demo/frontend && pnpm exec wrangler deploy --config ../x-refresh-worker/wrangler.toml
```

Deployed on 2026-11-11 with the owner's yes, from `dev` c52f1ae (wrangler 4.160.0,
version `6bb78c54-8986-44b6-a90d-7b806821dabf`, schedule `0 */8 * * *`). It has no
`workers.dev` URL (`workers_dev = false`): it has no fetch handler, so that URL only
answered 500. A local run of the handler (`wrangler dev --test-scheduled`, then
`/__scheduled`) logged `x-refresh: 200, 8 posts kept, stale false`.

`SITE_URL` in `wrangler.toml` names the site. Check a run with
`pnpm exec wrangler tail seams-voice-intents-x-refresh` (one log line a run:
the status, the number of kept posts and whether the answer was stale).
