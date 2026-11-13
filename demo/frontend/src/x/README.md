# The posts from X and the timeline

This folder holds the timeline of the notes app. The posts come from the
route `/api/x/eligible-posts` (`functions/api/x/eligible-posts.ts`). The
settings of the route (`X_*`) are in the [README of the site](../../README.md#settings).

## The route `/api/x/eligible-posts`

The route takes `GET` and answers
`{ posts, fetchedAtMs, stale }` or `{ error }`. The posts come from the X API's
AI Note Writer endpoint `GET /2/notes/search/posts_eligible_for_notes`: posts
where people on X asked for a Community Note. The route always calls X in test
mode and never sends a note to X.

- **Account.** The keys must belong to an X account that is enrolled as an AI
  Note Writer (<https://communitynotes.x.com/guide/en/api/overview>). The route
  signs with OAuth 1.0a (`functions/lib/oauth1.ts`).
- **Cost.** X bills each post ($0.005) and each author ($0.010) that it
  returns, once for each UTC day. The route keeps one snapshot and asks X again
  only after `X_ELIGIBLE_TTL_SECONDS`. With the defaults (10 posts, each 4
  hours), one call costs $0.15 at most, one day $0.90 and one week $6.30.
  With the 30 posts a call that `wrangler.toml` sets, one call costs $0.45 at
  most, one day $2.70 and one week $18.90. These are the highest costs: X
  gives many posts of the last call again, and it bills a post only once a
  day. The route cannot enforce a budget: set a spend
  limit in the X console, and bind `X_CACHE` so that all Cloudflare locations
  share one snapshot.
- **Snapshot.** `wrangler.toml` binds the KV namespace
  `seams-voice-intents-x-cache` as `X_CACHE`: one copy for all Cloudflare
  locations. Without the binding (local runs), the snapshot is in the Cache
  API, one copy for each location.
- **Failure.** If X fails, the route serves the old snapshot with
  `stale: true` and waits 60 s before the next call. Without a snapshot it
  answers 502. Without keys it answers 503.
- **Subject filter.** The posts are about what people on X dispute, so most
  are about politics or war. JEV sorts each new post once into one of
  `sport`, `science`, `technology`, `business`, `entertainment`, `health`,
  `politics`, `war`, `crime`, `adult` and `other`: one choice question for
  each post, 20 posts in one call (`functions/lib/topicFilter.ts`). The route
  gives only the posts with a subject in `X_ELIGIBLE_TOPICS`, each with its
  `topic`. The default is `science`, `technology`, `business` and `politics`.
  Sport, entertainment and health are not in it: most of
  their posts were of low quality (match numbers, rumours about famous people,
  medical claims). The route applies the list to the stored snapshot too, so a
  change of the list shows at once, without a call to X. A post that JEV gives no answer for, or a subject with a probability
  under 0.5, is `other`. If JEV fails, the refresh fails: no post shows without
  a subject. Without a JEV key (`TYPESAFE_API_KEY` or `NEAR_AI_API_KEY`) the
  route answers 503, unless `X_ELIGIBLE_TOPICS` is `all`.
- **Draft notes.** A NEAR AI chat model (`NEAR_AI_MODEL`) writes the draft of
  a Community Note for each shown post (`functions/lib/noteDrafts.ts`).
  The Seams server writes the spoken summary from the note. The write dialog starts with the draft and
  types it in, so a visitor only presses the button and speaks. The model
  cannot check a fact, so the draft says what the post leaves out (a source,
  a date, a fair comparison) and adds no fact of its own. The prompt gives
  the date, so the model does not call an event of this year "future". A
  draft with a link or a note over 280 characters is not used: the post then
  gets the careful template of its subject (`fallbackDraft` in
  `src/x/noteDrafts.ts`). Each draft has a mark, `source`: `model` or
  `template`. A model draft is final. A template is not: each refresh sends
  the newest 24 posts with a template to the model again (3 batches of 8).
  After 3 answers with no valid note for a post, its template is final. A
  failed call (no key, no credit, a timeout) counts no try, and it gets one
  more try at once. After 60 s of draft calls, no new call starts.  The write dialog
  says "Drafted by NEAR AI" only under a model draft, until the visitor
  changes the note. The five example posts have hand-written drafts, with
  no mark.

- **Collection.** About 1 post in 2 passes the default filter. The snapshot therefore keeps the passed
  posts of earlier calls, newest first, up to `X_ELIGIBLE_KEEP` (600). It grows
  by the new passed posts of each call. `wrangler.toml` sets 30 posts a call, so that the list of subjects gives enough shown posts. X gives many posts of the last call again, so a
  call adds fewer than 15 posts.
- **Schedule.** Pages Functions have no schedule: a visitor's request makes
  the call when the snapshot is old (at the TTL less 10 minutes, or less a
  tenth of a short TTL). The Worker `demo/x-refresh-worker` asks every 4 hours,
  so the posts come also when no one visits. Deploy it with the owner's
  approval (its README).
- **Pages.** `?offset=<n>&limit=<n>` (1 to 50) gives `limit` posts from
  `offset` (0 is the newest), with `total` and `nextOffset` (null at the
  end). Without `limit` the answer has all the posts. The timeline loads 5
  posts (`X_PAGE_SIZE`), then the next 5 when the visitor scrolls to the end
  of the timeline, above the voice bar. A spinner shows meanwhile, for at
  least 0.6 s (`loadMoreXPosts`).
- **Checks.** The route drops posts that X marks as sensitive. It checks each
  field of X's answer, and keeps only image URLs on `twimg.com`.

Each post is `{ id, text, createdAt, lang, url, author, media, metrics, topic, draft }`
(`XPost` in `src/x/types.ts`), and `draft` is `{ text, source, modelTries }`
(`modelTries` only for a template). The tests are in
`tests/x-eligible-posts.test.ts`, with a fake X API.

## The timeline

`src/x/Timeline.tsx` lists the posts from `/api/x/eligible-posts`. It is the
app's one view: a post has no page of its own, and every hash shows the timeline
(an old link to `#/notes/post/<id>` too).

- **A card** shows the post, its note and the note's market. The visitor acts
  on the card itself: "Write a note" opens the write dialog over the
  timeline, and "Bet" opens the market strip's bet sheet. A long note shows
  two lines and a "Show more" control. A note has its rating line ("Rate
  it", or the visitor's rating) on the card. A click on the card itself
  opens the strip's bet sheet while the market takes bets, and otherwise
  the write dialog.
  "Signed by voice" in the right column brings a note's card into view.
- **Tabs.** "For you" shows all posts. "Open markets" and "Settled" show the
  posts with a market in that state.
- **Post ids.** An X post id has 64 bits, and the Seams Wallet refuses a post
  id above 2^53 - 1. `notePostId` in `src/x/xPosts.ts` drops the lowest 10
  bits of the X id. That number is the `post_id` in the notes contract.
- **Lookup.** `toPost` turns an X post into a `Post` of the app, and
  `registerPosts` in `src/data/posts.ts` adds it to `findPost`. The write
  dialog and the text that JEV reads (`marketContext`) then work for it
  without a change.
- **Without the route.** `pnpm dev` without the function server shows the
  five example posts of `src/x/fixture.ts`. A build shows no posts and the
  line "The posts from X are not available now."
- `/timeline-preview.html` is the first design mock, with example notes and
  markets. It is dev only.
