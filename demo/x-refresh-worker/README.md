# X posts refresh (scheduled Worker)

The Community Notes timeline shows posts from X that can get a note. The route
`/api/x/eligible-posts` (`../frontend/functions/api/x/eligible-posts.ts`) keeps
one snapshot of them in KV and asks X for 10 new posts when the snapshot is
about 8 hours old. Cloudflare Pages Functions have no schedule, so without
visitors the route never asks. This Worker sends one request to the route at
00:00, 08:00 and 16:00 UTC. With 10 posts each time, the snapshot has about
60 posts after two days. A post that X gives again counts once, and the
subject filter leaves out some posts, so a call can add fewer than 10.

The Worker sends no key and the route needs none from it: the route makes the
call to X only when the snapshot is old, so extra requests cost nothing.

## Deploy

Deploy it only with the owner's approval. It is a new Worker in the
Cloudflare account of the site:

```bash
cd demo/frontend && pnpm exec wrangler deploy --config ../x-refresh-worker/wrangler.toml
```

`SITE_URL` in `wrangler.toml` names the site. Check a run with
`pnpm exec wrangler tail seams-voice-intents-x-refresh` (one log line a run:
the status, the number of kept posts and whether the answer was stale).
