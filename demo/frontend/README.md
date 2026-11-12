# Speak-to-Sign demo site

The site has one page, `/` (`index.html`): Community Notes, live on NEAR
testnet. A hero says what a spoken approval is and has the setup steps. The
notes app is on a sheet under the hero. The page style follows the Seams
Wallet site. Its code is in `src/showcase/` (`main.tsx`, `NotesPage.tsx`, and
`live.tsx` for the notes app with its signer).

## The voice route (`/api/voice-verify`)

The spoken bet of the note market records the microphone in the page
(`src/voice/recorder.ts`): a 16 kHz mono PCM16 WAV of at most 8 s. The page
sends it to `/api/voice-verify` (`functions/api/voice-verify.ts`), which calls
the OutLayer verifier with the request kind `market_bet` (the only kind that
the route takes; verifier 0.8.0 or later). The route needs the six
`VOICE_OUTLAYER_*` variables (see Settings). They take effect at the next
Pages deploy.

**Why the same OutLayer payment key.** Over HTTPS, OutLayer derives the
verifier's storage cell and its verdict signing key from the owner of the
payment key. Visitors enroll their voices through the Seams staging server,
so their templates are in the cell of the Seams payment key. With any other
payment key, every verify refuses `template_missing`, and the verdicts carry
a key that the contract does not pin.

The Seams verify route checks that the caller owns `owner`; this route cannot.
The voice check and the contract's predecessor check still bind each verdict to
the owner's voice and key. Each call spends OutLayer credit, so add a
Cloudflare rate-limiting rule on `/api/voice-verify` for a public link.

## Community Notes

A Community Notes page in the light style of X. You post a note and rate a
note with your voice, through Seams Speak-to-Sign. Testnet only. The post is
a real case that got a Community Note on X: the viral claim of 24 Oct 2026 that
Claude Code found 145,763 deleted iPhone photos. The posts from X can be about
politics or health, but not about war, crime or adult content.

- **Post a note.** You type the note. NEAR AI suggests a summary of 12 words
  or fewer. You read the summary aloud in the Seams Wallet card. The attested
  verifier checks the speaker and the words. Then the Seams Wallet signs
  `add_note` on the notes contract from your own NEAR account, with no
  confirm tap.
- **Rate a note.** You say "this note is helpful", "this note is somewhat
  helpful" or "this note is not helpful". The Wallet signs `rate_note`.

Pitch words: **Biometric CAPTCHA** is the voice gate. **Spoken Lease** is the
signed output: one call, for a short time.

Pitch sentence, for the X post: "Speak-to-Sign turns speech into a Confidential
Voice Intent. Your audio is sealed in the browser and opens only inside a TEE,
which signs who spoke and what they said."

There is no mock. Every note and rating is a real transaction on NEAR testnet,
signed by the real Seams Wallet after the real verifier accepts your voice.

The site has two pages on one origin, `https://speak-to-sign.pages.dev`:
Community Notes at `/` (`index.html`) and the Speak to pay example
(`../../examples/speak-to-pay`) at `/pay/`. Both use the same Seams project, so
one wallet works on both.

## What must be live

| Part                     | Where                                                        | Status on 12 Nov 2026                                  |
| ------------------------ | ------------------------------------------------------------ | ------------------------------------------------------ |
| Notes contract           | `notes.seams-v1.testnet` (`../contracts/community-notes/`)             | Deployed.                                              |
| Seams Wallet host        | `https://staging.sign.seams.sh`                              | Must be 0.69.0 (iframe protocol 25.0.0). Speak-to-Sign is a part of the Wallet. |
| Seams server (gateway)   | `https://staging.api.wallet.seams.sh`, route `/speak-to-sign/v1/verify` | Verifier 0.12.0 (version key `bfe81633…`): it opens sealed recordings. |
| Seams Wallet SDK         | `@seams/wallet`, `@seams/voiceid`                            | This page pins 0.69.0. It has no plugin package.       |
| Seams project            | Staging Seams Console: publishable key `seams-voice-intents` | Allows the Pages origin, `https://localhost:5443` and `https://localhost:8443`. |

## Run it locally

You need Node 22 or later and pnpm 10.

```bash
cd demo/frontend
pnpm install
cp .dev.vars.example .dev.vars   # then set NEAR_AI_API_KEY in .dev.vars
cp .env.example .env.local       # then set the VITE_SEAMS_* key and environment (ask the project owner)
```

Start the functions, the page and the HTTPS proxy, each in its own terminal:

```bash
pnpm dev:api     # wrangler pages dev on http://localhost:8788 (the functions under functions/api/)
```

```bash
pnpm dev         # Vite on http://localhost:5173, sends /api/* to port 8788
```

```bash
pnpm dev:https   # Caddy: https://localhost:5443 → 5173, https://localhost:8443 → 8788
```

Open https://localhost:5443 for the Community Notes page. Passkeys in the Wallet iframe need the app on
trusted HTTPS: on plain `http://localhost` the Wallet says "Passkeys require
trusted HTTPS for the app and wallet". Caddy signs the certificates with its
local CA (`tls internal`). If the browser does not trust it yet, run
`caddy trust` once (it asks for your password).

The Seams key allows only its listed origins. Add `https://localhost:5443`
(dev) and `https://localhost:8443` (built site) to the key in the staging Seams
Console. Without a publishable key, the page shows the notes, and the setup
panel says that the key is missing.

To run the whole site as Cloudflare Pages runs it (both pages and the function):

```bash
pnpm build:site   # demo/frontend/ into dist/, then ../../examples/speak-to-pay into dist/pay/
pnpm preview      # http://localhost:8788
```

`build:site` (`scripts/build-site.mjs`) needs `pnpm install` in
`../../examples/speak-to-pay` too. It gives the Speak to pay build the same
`VITE_SEAMS_*` settings as `demo/frontend/`, so it writes nothing into `examples/`.
The seal code (`sealAudio`) comes from `@seams/voice-verdict` on npm.

To sign in on the built site, open it through Caddy at https://localhost:8443
(`pnpm dev:https`), not at `http://localhost:8788`.

## Set up a wallet (in the page's setup panel)

1. **Sign in to Seams Wallet.** The Wallet's own menu opens: unlock with a
   passkey, or create a wallet. The account is a NEAR testnet account.
2. **Set up your voice.** One button, one set of recordings. The Wallet may
   ask for your passkey first. Then you read three phrases. If the wallet has
   no VoiceID yet, these recordings turn it on: that template stays on your
   device. The same recordings enroll your voice with the verifier after you
   confirm one signed message (NEP-413) that names exactly them. The verifier
   stores this template in its TEE. The page remembers the enrollment in your
   browser only, because the verifier has no status call.
3. **Testnet NEAR and USDC.** Each note or rating pays a little gas, and a bet
   on the note market pays USDC (1 USDC or more). **Get** asks the demo's faucet
   (`/api/faucet`): in one transaction it sends 0.2 NEAR and 2 USDC, once per
   account. The faucet is a small contract on `seams-faucet.testnet`
   (`../contracts/faucet/`). If it is empty, the step links to the public
   NEAR and USDC (faucet.circle.com) faucets.

A note shows on the post ("Readers added context …") when it has 2 or more
`helpful` ratings and more `helpful` than `not_helpful` ratings. The author
cannot rate their own note. So a full demo needs three wallets: the author
and two raters.

## Scripts

| Script           | What it does                                                         |
| ---------------- | -------------------------------------------------------------------- |
| `pnpm dev`       | Vite dev server with hot reload on port 5173.                        |
| `pnpm dev:api`   | `wrangler pages dev` for `functions/` on port 8788.                  |
| `pnpm build`     | Builds this page into `dist/`.                                       |
| `pnpm build:site`| Builds this page, then the Speak to pay page into `dist/pay/`.       |
| `pnpm preview`   | Serves `dist/` and `functions/` with wrangler on port 8788.          |
| `pnpm dev:https` | Caddy with local HTTPS: https://localhost:5443 and :8443.            |
| `pnpm typecheck` | Type-checks the page, `vite.config.ts` and the Pages Function.       |
| `pnpm test`      | Unit tests of the WAV, the resampling, the amount rules and the approve route (`node --test`). |

## Settings

Page settings are read at build time. The defaults are Seams staging, the only
deployment whose Seams server runs the verifier. Put them in `demo/frontend/.env.local`
for `pnpm dev`, or in `demo/frontend/.env.production.local` for a build (see `.env.example`).

| Variable                            | Default                               |
| ----------------------------------- | ------------------------------------- |
| `VITE_SEAMS_PUBLISHABLE_KEY`        | none: required for the Wallet         |
| `VITE_SEAMS_PROJECT_ENVIRONMENT_ID` | none: optional cross-check            |
| `VITE_SEAMS_WALLET_ORIGIN`          | `https://staging.sign.seams.sh`       |
| `VITE_SEAMS_RELAYER_URL`            | `https://staging.api.wallet.seams.sh` |
| `VITE_NOTES_CONTRACT`               | `notes.seams-v1.testnet`              |
| `VITE_NEAR_RPC_URL`                 | `https://test.rpc.fastnear.com`       |
| `VITE_NEAR_EXPLORER_URL`            | `https://testnet.nearblocks.io`       |
| `VITE_VOICE_AUDIO_KEY`              | none: recordings go as plain WAVs     |

With `VITE_VOICE_AUDIO_KEY` (standard base64 of the verifier's 32-byte audio
key), the note market seals each recording to the
verifier before it leaves the browser (`src/voiceRoute.ts`). The verify route
and OutLayer's coordinator then carry only ciphertext. This needs verifier
0.12.0 or later and the OutLayer secret `PROTECTED_AUDIO_KEY`. To print the
value, after a check of its signature against the verdict key that the
contract pins:

```bash
node --env-file=.dev.vars scripts/audio-key.mjs ed25519:<verdict key>
```

The publishable key belongs to a Seams project environment in the staging Seams
Console. The Wallet accepts sign-in only from the origins of that project. A
wallet belongs to one project.

Function settings are secrets. Put them in `demo/frontend/.dev.vars` for local runs, and
in the Cloudflare Pages project for the live site. Never commit `.dev.vars`.

| Variable          | Meaning                                                                 |
| ----------------- | ----------------------------------------------------------------------- |
| `NEAR_AI_API_KEY` | Key for NEAR AI: the chat model of the draft notes, and JEV (`/v1/systemone`) for the subject filter and the voice commands without `TYPESAFE_API_KEY`. Required. |
| `TYPESAFE_API_KEY` | Optional. Key for JEV at Typesafe: the subject filter and the voice commands use it in place of NEAR AI. |
| `NEAR_AI_MODEL`   | Optional. The chat model of the draft notes. Default `Qwen/Qwen3.8-27B`, a small model that NEAR AI hosts. |
| `FAUCET_PRIVATE_KEY` | The faucet's function-call key (`ed25519:…`). It can call `drip` on `seams-faucet.testnet` and nothing else, with a 1 NEAR gas allowance. Required for `/api/faucet`. |
| `FAUCET_ACCOUNT`  | Optional. Default `seams-faucet.testnet`.                               |
| `NEAR_RPC_URL`    | Optional, for `/api/faucet`. Default `https://test.rpc.fastnear.com`. |
| `X_API_KEY`, `X_API_SECRET` | Secret. The OAuth 1.0a Consumer Key and secret of the X app of a Community Notes AI Note Writer account. Required for `/api/x/eligible-posts`. |
| `X_ACCESS_TOKEN`, `X_ACCESS_TOKEN_SECRET` | Secret. The OAuth 1.0a Access Token and secret of the same account. Required. A Bearer Token does not work on this endpoint. |
| `X_ELIGIBLE_MAX`  | Optional. Posts for each call to X, 1 to 100. Default 10; `wrangler.toml` sets 20. |
| `X_ELIGIBLE_KEEP` | Optional. The most posts that the snapshot keeps, 10 to 2000. Default 600. |
| `X_ELIGIBLE_TTL_SECONDS` | Optional. The route asks X again after this time. Default 28800 (8 hours), minimum 60. |
| `X_ELIGIBLE_LANG` | Optional. A language code such as `ja`, or `all`. X's default is English. |
| `X_ELIGIBLE_TOPICS` | Optional. The subjects that `/api/x/eligible-posts` shows, as a comma list. Default `sport,science,technology,business,entertainment,politics,health`. `all` turns the filter off. The filter needs a JEV key: `TYPESAFE_API_KEY` or `NEAR_AI_API_KEY`. |
| `VOICE_OUTLAYER_BASE_URL` | For `/api/voice-verify`. The OutLayer API, for example `https://api.outlayer.fastnear.com`. |
| `VOICE_OUTLAYER_PROJECT` | `owner/project` of the verifier, as in the Seams staging verify route. |
| `VOICE_OUTLAYER_VERSION_KEY` | The WASM hash of a verifier version with `market_bet` (0.8.0 or later; 0.12.0 or later for sealed recordings). |
| `VOICE_OUTLAYER_PAYMENT_KEY` | Secret. The OutLayer payment key of the Seams staging verify route. Another key finds no voice templates. |
| `VOICE_OUTLAYER_SECRETS_PROFILE` | The secrets profile of the Seams staging verify route. |
| `VOICE_OUTLAYER_SECRETS_ACCOUNT_ID` | The secrets account of the Seams staging verify route. |

Without the `VOICE_OUTLAYER_*` variables, `/api/voice-verify` answers 503 with
the names of the missing variables, and the bet form shows that text.

## How the page talks to the Wallet

- `src/showcase/main.tsx` wraps the page in one `SeamsWebProvider` with the configuration
  from `src/seams/seamsConfig.ts`: `seamsTestnetConfig` with the publishable
  key, VoiceID, and Speak-to-Sign on testnet. The SDK derives the passkey
  RP ID (the Wallet host) and the Router A/B signing worker from the Wallet origin.
- `src/signer/notesSigner.ts` is the seam. The UI codes only against it.
- `src/signer/seamsSigner.ts` fills it with the typed SDK calls (0.69.0, `seams.near.spoken`):
  - `requestNote` → `seams.near.spoken.note({ walletSession, contract, postId, text, summary })`
  - `requestRating` → `seams.near.spoken.rating({ walletSession, contract, noteId, rating })`
  - `enableVoice` → `seams.registration.setAuthMethodEnabled` when the owner turned VoiceID off
  - `enroll` → `seams.near.spoken.enroll({ walletSession })`, which also turns on VoiceID for a new wallet
  - Each SDK refusal (`speaker`, `words`, `summary_not_speakable`, …) becomes a
    reason in plain words.
- `src/components/SignInModal.tsx` shows the SDK's `HostedSeamsAuthMenu`. The
  CSS variable `--seams-wallet-inline-dialog-z` puts the Wallet's menu above
  the page's modal.
- During a spoken request, the Wallet shows its own VoiceID card: the sentence,
  Record, the checks and the result. The call returns when you close that card.

## Notes store

`src/notes/rpcStore.ts` calls the contract views over NEAR JSON-RPC:
`get_notes({ post_id })` and `get_rating({ note_id, account_id })`. Ids are JSON
numbers. After a sent result, the page reads the post again until the new note
or the new counts show.

## Posts that can get a note: `/api/x/eligible-posts`

`functions/api/x/eligible-posts.ts` takes `GET` and answers
`{ posts, fetchedAtMs, stale }` or `{ error }`. The posts come from the X API's
AI Note Writer endpoint `GET /2/notes/search/posts_eligible_for_notes`: posts
where people on X asked for a Community Note. The route always calls X in test
mode and never sends a note to X.

- **Account.** The keys must belong to an X account that is enrolled as an AI
  Note Writer (<https://communitynotes.x.com/guide/en/api/overview>). The route
  signs with OAuth 1.0a (`functions/lib/oauth1.ts`).
- **Cost.** X bills each post ($0.005) and each author ($0.010) that it
  returns, once for each UTC day. The route keeps one snapshot and asks X again
  only after `X_ELIGIBLE_TTL_SECONDS`. With the defaults (10 posts, each 8
  hours), one call costs $0.15 at most, one day $0.45 and one week $3.15.
  The budget is $5 to $10 a week. The route cannot enforce it: set a spend
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
  `topic`. A post that JEV gives no answer for, or a subject with a probability
  under 0.5, is `other`. If JEV fails, the refresh fails: no post shows without
  a subject. Without a JEV key (`TYPESAFE_API_KEY` or `NEAR_AI_API_KEY`) the
  route answers 503, unless `X_ELIGIBLE_TOPICS` is `all`. On the 13 posts of
  2026-11-12, JEV gave the subject of the earlier chat model to 12, in 1.1 s.
- **Draft notes.** A NEAR AI chat model (`NEAR_AI_MODEL`) writes the draft of
  a Community Note for each shown post, once (`functions/lib/noteDrafts.ts`).
  The Seams server writes the spoken summary from the note. The write dialog starts with the draft and
  types it in, so a visitor only presses the button and speaks. The model
  cannot check a fact, so the draft says what the post leaves out (a source,
  a date, a fair comparison) and adds no fact of its own. A draft with a
  link, a note over 280 characters or a sentence that the Wallet cannot take
  is not used: the post then gets the careful draft of its subject
  (`fallbackDraft` in `src/x/noteDrafts.ts`). The five example posts have
  hand-written drafts.
- **Collection.** About 1 post in 4 passes the default filter. The snapshot
  therefore keeps the passed posts of earlier calls, newest first, up to
  `X_ELIGIBLE_KEEP` (600). It grows by the new passed posts of each call. With
  the 20 posts a call that `wrangler.toml` sets, that is about 5 posts, about 30
  after two days; 10 new shown posts a call (60 after two days) need about 40
  posts a call (`X_ELIGIBLE_MAX=40`), which costs about twice as much as 20.
- **Schedule.** Pages Functions have no schedule: a visitor's request makes
  the call when the snapshot is old (at the TTL less 10 minutes, or less a
  tenth of a short TTL). The Worker `../x-refresh-worker` asks every 8 hours,
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
(`XPost` in the function file). The tests are in
`tests/x-eligible-posts.test.ts`, with a fake X API. A local run against the
real X API on 10 Nov 2026 gave 10 English posts, from 2 hours to 2 days old.
X took the `tweet.fields` name. Of 20 posts, 5 passed the default filter (2
sport, 1 science, 1 technology, 1 entertainment). The model put the posts on
Gaza, vaccines, politicians and crime numbers in their own subjects.

## The Community Notes page as one app

`src/showcase/NotesPage.tsx` is the page at `/`. It has three layers:

- **The nav**, the one bar of the page, 44 pixels high: at the left one pill
  with the name and the gradient picker; at the right "Built on NEAR" (NEAR's
  wordmark, a link to near.org), Seams (the logo of wallet.seams.sh, a link
  to it; the mark alone on a phone) and GitHub, in the same glass pills. Its
  content is as wide as the notes app's layout (1220 pixels), so its two
  ends line up with the app's edges. It stays at the top and has no ground of its own: it lies over the
  top of the hero. When the sheet covers the hero, that strip of the hero
  stays in sight, so the nav keeps the hero's gradient. The notes app's own top line is hidden on this page. When
  the sheet covers the hero, the setup steps show in the nav, until every
  step is done. The next step is the primary action: a white pill with a
  black button. A done step is a green check, and a later step is glass.
  A screen narrower than 1200 pixels shows only the next step.
- **The hero**, about voice signatures, on a moving grain field of the Seams
  site: the title, one sentence, and the setup
  steps as one strip (`#setup`). The field is the `GrainField` of
  seams-monorepo (`packages/grain-field-ts`, copied into
  `src/showcase/grain/`): one WebGL shader that smooths a 12 × 12 colour
  grid, flows it and adds grain. The page has two themes, and each has
  one of the site's gradients: Light mode (Apricot Beam) and
  Dark mode (Onyx Black, with X's black, Lights out). The theme picker
  (`ThemePicker.tsx`, `theme.ts`), in the nav's brand pill, is a round button with a picture of the field. It opens a menu of
  three choices, each with a picture: the two themes, and System (the default), which follows the
  system's light or dark setting (`prefers-color-scheme`) and changes when it changes.
  The arrow keys change the theme as they move.
  The choice stays in this browser (`localStorage`), and `?theme=light`,
  `?theme=dark` or `?theme=system` picks one for a link. The page puts the theme (light or dark)
  on the root element as `data-theme`. The
  dark colours are tokens in `src/styles.css`, for the notes app, its dialogs
  and the sheet; the hero and the nav do not change. A light field gets a soft dark shade
  on the left (`--field-scrim`), so the white text stays readable. NEAR's N
  mark (`nearMarks.tsx`, as on tatchi.xyz) lies big and faint over the field
  at the right, turned 30 degrees, behind the hero's text.
- **The sheet**, with the notes app in the page itself, not in a window. The
  sheet has the theme's plain ground (white in Light mode), also at the sides
  of the app.

The page is the one scroll area. The hero stays in place, and the sheet moves
up over it like paper. While the sheet covers it, the hero goes back a little,
blurs and dims (`--cover`, set from the scroll position). The same scroll then
goes on down the feed: on this page the notes app does not scroll itself
(`.ss-sheet .notes-app` in `showcase.css`), so one gesture is enough. The
app's sticky parts (the tabs, the navigation, the right column) stick under
the nav, and the phone's bottom bar sticks to the bottom of the screen. The
scroll area (`.ss-scroll`) starts under the nav, and the field is a layer of
its own behind the nav and the hero (`.ss-ground`). So nothing that scrolls
can come behind the nav, with no script: the nav always shows the field, and
the scroll area's round top corners are the sheet's corners at the nav. A post
that opens starts at the top of the sheet.

The app opens on the timeline. Its right column (`src/x/VoiceFeed.tsx`) has a
search box for the look only, and "Signed by voice": the newest notes with the sentence that each
author said, shown only when there is a note. "Home" in the app's navigation opens the timeline.

## The timeline

`src/x/Timeline.tsx` lists the demo post and the posts from
`/api/x/eligible-posts`. It is the app's one view: a post has no page of its
own, and every hash shows the timeline (an old link to `#/notes/post/<id>`
too).

- **A card** shows the post, its note and the note's market. The visitor acts
  on the card itself: "Write a note" opens the write dialog over the
  timeline, and "Bet" opens the bet dialog (the demo post) or the market
  strip's bet sheet (a note of this app). A long note, or one with more
  lines, shows two lines and a "Show more" control. A note of this app has
  its rating line ("Rate it", or the visitor's rating) on the card. A click
  on the card itself opens the bet (the demo post's dialog, or the strip's
  bet sheet while the market takes bets), and otherwise the write dialog.
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
  five example posts of `src/x/fixture.ts`. A build shows the demo post and
  the line "The posts from X are not available now."
- `/timeline-preview.html` is the first design mock, with example notes and
  markets. It is dev only.

## The spoken summary of a note

The page gives the Seams Wallet only the note (`spoken.note({ contract, postId, text })`).
It gives no summary, so it cannot choose the words that the author says:

1. The Wallet asks the Seams server for a summary. The server writes it from the
   note with `Qwen/Qwen3.8-27B` on NEAR AI, with thinking off.
2. The Wallet card shows the note, the summary under it, and the voice line.
   The author says the summary.
3. The verifier gets the note text. It checks the voice and the words, and it asks
   JEV if the summary gives the main point of the note. A summary that does not
   fit gives `summary_mismatch`.

This needs the Seams Wallet with iframe protocol 25.0.0 and verifier 0.13.0
(see `docs/note-summary-plan.md`).

## Deploy to Cloudflare Pages

Ask the project owner before you deploy or add a domain.

With wrangler (direct upload), from `demo/frontend/`:

```bash
pnpm exec wrangler pages project create speak-to-sign --production-branch main
```

```bash
pnpm exec wrangler pages secret put NEAR_AI_API_KEY --project-name speak-to-sign
```

```bash
pnpm exec wrangler pages secret put FAUCET_PRIVATE_KEY --project-name speak-to-sign
```

For the spoken bet, set the six `VOICE_OUTLAYER_*` variables the same way
(`wrangler pages secret put VOICE_OUTLAYER_PAYMENT_KEY …`), with the values of
the Seams staging verify route.

```bash
pnpm build:site && pnpm exec wrangler pages deploy dist --project-name speak-to-sign --branch main
```

Run `wrangler pages deploy` from `demo/frontend/`, so that it finds `functions/`.
`--branch main` makes it the production deployment. Without it, wrangler uses
the git branch, and the page gets a preview origin that staging does not allow.

The live origin is `https://speak-to-sign.pages.dev`. Seams staging must
allow it (CORS and the project's allowed origins), and also
`http://localhost:5173` for local runs. If Cloudflare gives the project another
`pages.dev` name, staging must allow that name instead.

Build with `demo/frontend/.env.production.local` (or the environment) set to the key of
the project that allows the Pages origin. One deploy ships the site and `/pay/`. Do not
deploy `../../examples/speak-to-pay` alone to the same project: that would
replace the whole site with the Speak to pay page.

The routes `/api/voice-command` and `/api/x/eligible-posts` spend NEAR AI credit.
For a public link, add a Cloudflare rate-limiting rule on them (and on
`/api/voice-verify`, see above).

## Files

| Path                             | What it is                                                 |
| -------------------------------- | ---------------------------------------------------------- |
| `src/signer/notesSigner.ts`      | The signer seam and the rating sentences.                  |
| `src/signer/seamsSigner.ts`      | The Seams Wallet signer and the plain-word reasons.        |
| `src/seams/seamsConfig.ts`       | The SeamsWeb configuration.                                |
| `src/notes/`                     | Note types, the contract rule, the RPC store, the balance. |
| `src/components/`                | Note parts, modals, setup panel.                           |
| `src/data/posts.ts`              | Fictional posts.                                           |
| `functions/api/faucet.ts`        | The testnet faucet: one `drip` transaction for an account. |
| `src/faucet/nearTx.ts`           | A small NEAR signer for the functions (Borsh, WebCrypto Ed25519). |
| `src/voice/recorder.ts`, `wav.ts` | The microphone recorder and the verifier's WAV.            |
| `functions/api/voice-verify.ts`  | Sends a `market_bet` voice check to the OutLayer verifier. |
| `functions/lib/http.ts`          | The parts that the functions share: same origin, body size, JSON. |
| `tests/`                         | Unit tests (`pnpm test`).                                  |

## Design rules

- The look copies X's light theme: icon rail, "Post" header, post card, the
  notes box, the "Do you find this helpful? Rate it" row, the modals and the
  blue toast.
- No X logo or wordmark. The logo slot holds a neutral icon.
- The post is a real case, shown with care (`src/data/posts.ts`):
  - It is re-created from news reports. Its account farms engagement, so the
    page shows "Engagement account" and not its name or handle.
  - The picture is a drawing of the claim, labeled "Drawing of the claim", not
    the original video.
  - A line says what happened and links to a fact-check.
  - The page does not invent reply, repost, like or view counts.
  - No political posts.
- System fonts. X's own font is proprietary.
