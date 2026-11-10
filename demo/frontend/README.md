# Speak-to-Sign demo site

The site has one page for each example. Each page says what a spoken approval
is, has the Set up card, and shows its application as a small screen in a
hand-drawn frame. A click on the screen grows it into a window of about 90% of
the screen, and the app in it works.

- `/` (`index.html`): Community Notes, live on NEAR testnet (window `#/notes`).
- `/multisig/` (`multisig/index.html`): the voice multisig (window
  `#/multisig`). It works against its testnet contract, and shows example data
  if the contract account has no code. An old link to `/#/multisig` goes to
  `/multisig/#/multisig`.

Both pages load the same script (`src/showcase/main.tsx`). The `data-page`
attribute on `<html>` names the example. A link under the example and the
footer lead to the other page. The page style follows the Seams Wallet site.
Its code is in `src/showcase/`.

The live app renders once (`src/showcase/live.tsx`), and its element moves
between its small screen and the window, so the app keeps its page, sign-in
and data. The notes app scrolls itself, and its layout follows the window size
(container queries), not the screen size.

## Voice multisig (`/multisig/`)

A NEAR multisig where a new visitor moves a small amount of testnet NEAR with
one spoken approval. The spec is `../../docs/voice-multisig-guests.md`. The
screen, `LiveMultisigScreen` in `src/multisig/`, draws the transactions of a
multisig wallet and works on NEAR testnet against the contract in
`VITE_MULTISIG_CONTRACT` (default `multisig.seams-v1.testnet`,
`../contracts/voice-multisig/`). It opens on the **New proposal** tab. The
**History** tab lists the open and the executed proposals, newest first.
The contract has two admins, `admin-a.seams-v1.testnet` and
`admin-b.seams-v1.testnet`. They are plain key signers. For the demo, the
page shows them as signers like the visitor, "Admin A" and "Admin B", with
no key icon and no words about keys.

1. **Propose.** The visitor types a receiver and an amount (default 0.01
   NEAR to `seams-grants.testnet`; any amount that the grammar can speak,
   with no cap), and reads "Approve proposal 1: send 0.01 NEAR to
   seams-grants.testnet" aloud. The hint under the sentence says that
   "point" can stand for "dot" and that "dash" can be left out. The
   verifier checks the voice and the
   words, keeps the transfer, and returns a salted commitment and the salt.
   The page keeps the opening (receiver, amount, salt, commitment) in this
   browser's `localStorage`. The Wallet signs `propose`; the chain gets only
   the commitment.
2. **Approve.** The page sends the opening to `/api/multisig/approve`
   (`functions/api/multisig/approve.ts`). Admin A calls `approve`, admin B
   calls `approve`, and admin B calls `execute` with the opening. The
   contract checks the opening against the commitment and sends the NEAR.
3. **Receipt.** The page shows three ticks (your approval, Admin A,
   Admin B), then the receipt with the explorer link. Then it deletes the
   opening.

If the route fails, or the transfer does not arrive, the page shows
**Finish the transfer**. It calls the route again, which continues from the
first step that is not done. The opening stays in `localStorage` until the
transfer is executed, so the button also shows in **History** after a
reload, on the open proposal that this browser holds the opening of.
If the browser loses the opening, nobody can execute the proposal: propose
again.

If the visitor has no voice enrolled or no NEAR for gas, the form sends them
to the **Set up** card of the page, which enrolls the voice and calls the
faucet. An admin account cannot propose.

The page records the microphone itself (`src/multisig/recorder.ts`): a 16 kHz
mono PCM16 WAV of at most 8 s, with Stop and an automatic stop at 8 s. It sends
it to `/api/voice-verify` (`functions/api/voice-verify.ts`), which calls the
OutLayer verifier with the request kind `multisig_propose` (the only kind
that the route takes). The Wallet signs `propose` as a normal function call
(0 NEAR, 30 Tgas) with its passkey confirm step. The verdict is valid for two
minutes, so confirm in the Wallet soon after the check.

If the contract view fails because the account or its code is missing, the
screen shows example data with the note "Contract not deployed yet", and
nothing records.

### The approve route

`POST /api/multisig/approve` with `{ proposal_id, receiver, amount_yocto,
salt_hex }`. It takes requests from this site only.

- It reads `get_proposal` and `get_config`. It answers 404 if there is no
  proposal, 409 if the proposal is executed, and 400 if the input is bad.
  It sets no cap. If the amount is above the balance of the multisig,
  `execute` fails ("Exceeded the account balance."), the answer names the
  step `execute`, and the proposal stays open.
- Admin A calls `approve` (30 Tgas) if it did not approve yet. Then admin B
  does the same. Then admin B calls `execute` (50 Tgas: the commitment
  check, the transfer and its callback).
- It answers `{ proposal, executeTransactionHash, executed }`. `executed` is
  the result of the callback: `false` if the transfer did not arrive. On a
  failure it answers 502 with `{ error, step }`. The step is `read`,
  `admin_a`, `admin_b` or `execute`.
- It signs with `signAndSendCall` from `src/faucet/nearTx.ts`. Each admin key
  is a function-call key for `approve` and `execute` on the multisig
  contract only. One proposal costs 1 voice check and 3 admin transactions
  of gas.

### What it needs live

Each deploy is the project owner's decision.

| Part | What | Note |
| --- | --- | --- |
| Contract | `multisig.seams-v1.testnet`, built from `../contracts/voice-multisig/` | Deployed on 2026-11-10 (tx `BcBCruDvJ5MCyDPxRKqm7BCCXgUuyr1NfmeFXXZg6Dwz`). If the account has no code, the window shows example data. It was deployed with `new(admins, verifier_public_key)`: the two admins and the verifier key `ed25519:E8E53ydtc9LRvVz9xBCRrSzyBa5nh1gK1ts53Aoo751U`. Fund it with a plain transfer. It replaces `team.seams-v1.testnet` (deployed on 2026-11-10 with a cap of 0.05 NEAR), which stays on chain. The page refuses the config of that first deploy, so the window shows "The multisig contract answered in an unexpected form." for it. |
| Admins | `admin-a.seams-v1.testnet` and `admin-b.seams-v1.testnet` | Each has NEAR for gas and a function-call key for `approve` and `execute` on the contract. The keys are the Pages secrets `MULTISIG_ADMIN_A_KEY` and `MULTISIG_ADMIN_B_KEY`. A function-call key names one contract, so the new contract needs new keys in these secrets. |
| Receiver | `seams-grants.testnet` | A Seams account, the default receiver. |
| Verifier | An OutLayer verifier version with `multisig_propose` that reads "point" and a left-out "dash" (0.6.1 or later) | 0.6.1, `f56ba0e8…`. Its WASM hash goes in `VOICE_OUTLAYER_VERSION_KEY`. |
| Pages secrets | The six `VOICE_OUTLAYER_*` variables and the two admin keys (see Settings) | The `VOICE_OUTLAYER_*` values are the payment key, project and secrets profile (`main`, `cyan-loong.testnet`) of the Seams staging verify route, with the 0.6.1 version key. They take effect at the next Pages deploy. |

**Why the same OutLayer payment key.** Over HTTPS, OutLayer derives the
verifier's storage cell and its verdict signing key from the owner of the
payment key. Visitors enroll their voices through the Seams staging server,
so their templates are in the cell of the Seams payment key. With any other
payment key, every verify refuses `template_missing`, and the verdicts carry
a key that the contract does not pin. The page shows that refusal as "This
account has no voice on this verifier".

The Seams verify route checks that the caller owns `owner`; this route cannot.
The voice check and the contract's predecessor check still bind each verdict to
the owner's voice and key. Each call spends OutLayer credit, and each approve
call spends admin gas, so add Cloudflare rate-limiting rules on
`/api/voice-verify` and `/api/multisig/approve` for a public link.

### Try it

1. Sign in with a wallet that is not an admin, and use **Set up your voice**
   in the Set up card. The card also gets testnet NEAR from the faucet.
2. Open the multisig window on `/multisig/`. It opens on **New proposal**. Keep
   `seams-grants.testnet` and `0.01`, press **Record**, and read the
   sentence. Then confirm in the Wallet.
3. Wait for the three ticks and the receipt. If a step fails, press
   **Finish the transfer**.

## Community Notes (`#/notes`)

A Community Notes page in the light style of X. You post a note and rate a
note with your voice, through Seams Speak-to-Sign. Testnet only. The post is
a real case that got a Community Note on X: the viral claim of 24 Oct 2026 that
Claude Code found 145,763 deleted iPhone photos. The page stays away from
political posts.

- **Post a note.** You type the note. NEAR AI suggests a summary of 12 words
  or fewer. You read the summary aloud in the Seams Wallet card. The attested
  verifier checks the speaker and the words. Then the Seams Wallet signs
  `add_note` on the notes contract from your own NEAR account, with no
  confirm tap.
- **Rate a note.** You say "this note is helpful", "this note is somewhat
  helpful" or "this note is not helpful". The Wallet signs `rate_note`.

Pitch words: **Biometric CAPTCHA** is the voice gate. **Spoken Lease** is the
signed output: one call, for a short time.

There is no mock. Every note and rating is a real transaction on NEAR testnet,
signed by the real Seams Wallet after the real verifier accepts your voice.

The site has three pages on one origin, `https://seams-voice-intents.pages.dev`:
Community Notes at `/` (`index.html`), the voice multisig at `/multisig/`
(`multisig/index.html`), and the Speak to pay example
(`../../examples/speak-to-pay`) at `/pay/`. All use the same Seams project, so
one wallet works on all three.

## What must be live

| Part                     | Where                                                        | Status on 9 Nov 2026                                   |
| ------------------------ | ------------------------------------------------------------ | ------------------------------------------------------ |
| Notes contract           | `notes.seams-v1.testnet` (`../contracts/community-notes/`)             | Deployed.                                              |
| Seams Wallet host        | `https://staging.sign.seams.sh`                              | 0.60.0: Speak-to-Sign host API 7 with spoken notes.    |
| Seams server (gateway)   | `https://staging.api.wallet.seams.sh`, route `/speak-to-sign/v1/verify` | Verifier 0.4.1 (staging deploy b77bf2cf): community notes and ratings. |
| Seams Wallet SDK         | `@seams/wallet`, `@seams/voiceid`, `@seams/speak-to-sign`    | This page pins 0.60.0.                                 |
| Seams project            | Staging Seams Console: publishable key `seams-voice-intents` | Allows the Pages origin, `https://localhost:5443` and `https://localhost:8443`. |

## Run it locally

You need Node 22 or later and pnpm 10.

```bash
cd demo/frontend
pnpm install
cp .dev.vars.example .dev.vars   # then set NEAR_AI_API_KEY in .dev.vars
cp .env.example .env.local       # then set the VITE_SEAMS_* key and environment (ask the project owner)
```

Start the summary function, the page and the HTTPS proxy, each in its own terminal:

```bash
pnpm dev:api     # wrangler pages dev on http://localhost:8788 (the /api/summary function)
```

```bash
pnpm dev         # Vite on http://localhost:5173, sends /api/* to port 8788
```

```bash
pnpm dev:https   # Caddy: https://localhost:5443 → 5173, https://localhost:8443 → 8788
```

Open https://localhost:5443 for the Community Notes page,
https://localhost:5443/#/notes for its window, and
https://localhost:5443/multisig/ for the voice multisig page. Passkeys in the Wallet iframe need the app on
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
| `VITE_MULTISIG_CONTRACT`            | `multisig.seams-v1.testnet`           |
| `VITE_NEAR_RPC_URL`                 | `https://test.rpc.fastnear.com`       |
| `VITE_NEAR_EXPLORER_URL`            | `https://testnet.nearblocks.io`       |

The publishable key belongs to a Seams project environment in the staging Seams
Console. The Wallet accepts sign-in only from the origins of that project. A
wallet belongs to one project.

Function settings are secrets. Put them in `demo/frontend/.dev.vars` for local runs, and
in the Cloudflare Pages project for the live site. Never commit `.dev.vars`.

| Variable          | Meaning                                                                 |
| ----------------- | ----------------------------------------------------------------------- |
| `NEAR_AI_API_KEY` | Key for `https://cloud-api.near.ai/v1/chat/completions`. Required.      |
| `NEAR_AI_MODEL`   | Optional. Default `Qwen/Qwen3.8-27B`, a small model that NEAR AI hosts. |
| `FAUCET_PRIVATE_KEY` | The faucet's function-call key (`ed25519:…`). It can call `drip` on `seams-faucet.testnet` and nothing else, with a 1 NEAR gas allowance. Required for `/api/faucet`. |
| `FAUCET_ACCOUNT`  | Optional. Default `seams-faucet.testnet`.                               |
| `NEAR_RPC_URL`    | Optional, for `/api/faucet` and `/api/multisig/approve`. Default `https://test.rpc.fastnear.com`. |
| `X_API_KEY`, `X_API_SECRET` | Secret. The OAuth 1.0a Consumer Key and secret of the X app of a Community Notes AI Note Writer account. Required for `/api/x/eligible-posts`. |
| `X_ACCESS_TOKEN`, `X_ACCESS_TOKEN_SECRET` | Secret. The OAuth 1.0a Access Token and secret of the same account. Required. A Bearer Token does not work on this endpoint. |
| `X_ELIGIBLE_MAX`  | Optional. Posts for each call to X, 1 to 100. Default 10.               |
| `X_ELIGIBLE_TTL_SECONDS` | Optional. The route asks X again after this time. Default 28800 (8 hours), minimum 60. |
| `X_ELIGIBLE_LANG` | Optional. A language code such as `ja`, or `all`. X's default is English. |
| `X_ELIGIBLE_TOPICS` | Optional. The subjects that `/api/x/eligible-posts` shows, as a comma list. Default `sport,science,technology,business,entertainment`. `all` turns the filter off. The filter needs `NEAR_AI_API_KEY`. |
| `VOICE_OUTLAYER_BASE_URL` | For `/api/voice-verify`. The OutLayer API, for example `https://api.outlayer.fastnear.com`. |
| `VOICE_OUTLAYER_PROJECT` | `owner/project` of the verifier, as in the Seams staging verify route. |
| `VOICE_OUTLAYER_VERSION_KEY` | The WASM hash of a verifier version with `multisig_propose` (0.6.1 or later). The page hint says that "point" and a left-out "dash" match, which needs 0.6.1. |
| `VOICE_OUTLAYER_PAYMENT_KEY` | Secret. The OutLayer payment key of the Seams staging verify route. Another key finds no voice templates. |
| `VOICE_OUTLAYER_SECRETS_PROFILE` | The secrets profile of the Seams staging verify route. |
| `VOICE_OUTLAYER_SECRETS_ACCOUNT_ID` | The secrets account of the Seams staging verify route. |
| `MULTISIG_ADMIN_A_KEY` | Secret. Admin A's function-call key (`ed25519:…`) for `approve` and `execute` on the multisig contract. Required for `/api/multisig/approve`. |
| `MULTISIG_ADMIN_B_KEY` | Secret. Admin B's function-call key, the same way. Required for `/api/multisig/approve`. |
| `MULTISIG_ADMIN_A` | Optional. Default `admin-a.seams-v1.testnet`. |
| `MULTISIG_ADMIN_B` | Optional. Default `admin-b.seams-v1.testnet`. |
| `MULTISIG_CONTRACT` | Optional. Default `multisig.seams-v1.testnet`. It must be the contract of `VITE_MULTISIG_CONTRACT`. |

Without the `VOICE_OUTLAYER_*` variables, `/api/voice-verify` answers 503 with
the names of the missing variables, and the multisig screen shows that text.
Without the two admin keys, `/api/multisig/approve` does the same, and the
screen shows **Finish the transfer**.

## How the page talks to the Wallet

- `src/showcase/main.tsx` wraps the page in one `SeamsWebProvider` with the configuration
  from `src/seams/seamsConfig.ts`: `seamsTestnetConfig` with the publishable
  key, VoiceID, and Speak-to-Sign on testnet. SDK 0.60.0 derives the passkey
  RP ID (the Wallet host) and the Router A/B signing worker from the Wallet origin.
- `src/signer/notesSigner.ts` is the seam. The UI codes only against it.
- `src/signer/seamsSigner.ts` fills it with the typed SDK calls (0.60.0):
  - `requestNote` → `seams.speakToSign.requestNote({ walletId, contract, postId, text, summary })`
  - `requestRating` → `seams.speakToSign.requestRating({ walletId, contract, noteId, rating })`
  - `enableVoice` → `seams.registration.setAuthMethodEnabled` when the owner turned VoiceID off
  - `enroll` → `seams.speakToSign.enroll({ walletId })`, which also turns on VoiceID for a new wallet
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
  are about politics or war. A NEAR AI model sorts each new post once into
  one of `sport`, `science`, `technology`, `business`, `entertainment`,
  `health`, `politics`, `war`, `crime`, `adult` and `other`
  (`functions/lib/topicFilter.ts`). The route gives only the posts with a
  subject in `X_ELIGIBLE_TOPICS`, each with its `topic`. A post that the model
  does not answer for is `other`. If the model fails, the refresh fails: no
  post shows without a subject. Without `NEAR_AI_API_KEY` the route answers
  503, unless `X_ELIGIBLE_TOPICS` is `all`.
- **Collection.** About 1 post in 4 passes the default filter. The snapshot
  therefore keeps the passed posts of earlier calls, 30 at most, newest first.
- **Checks.** The route drops posts that X marks as sensitive. It checks each
  field of X's answer, and keeps only image URLs on `twimg.com`.

Each post is `{ id, text, createdAt, lang, url, author, media, metrics, topic }`
(`XPost` in the function file). The tests are in
`tests/x-eligible-posts.test.ts`, with a fake X API. A local run against the
real X API on 10 Nov 2026 gave 10 English posts, from 2 hours to 2 days old.
X took the `tweet.fields` name. Of 20 posts, 5 passed the default filter (2
sport, 1 science, 1 technology, 1 entertainment). The model put the posts on
Gaza, vaccines, politicians and crime numbers in their own subjects.

## The Community Notes page as one app

`src/showcase/NotesPage.tsx` is the page at `/`. It has the height of the
screen, with three parts:

- **The nav**, with both examples, Speak to pay and GitHub.
- **The banner** about voice signatures: the title, one sentence, the
  signature card (`SignatureCard.tsx`: a spoken sentence, the two checks and
  "Signed", as a loop) and the setup steps as one strip (`#setup`).
- **The notes app**, in the page itself, not in a window. It scrolls inside
  the page. When it scrolls, the banner folds to one line; a click on that
  line, or a scroll back to the top, opens the banner again.

The app opens on the timeline. Its right column, "Signed by voice"
(`src/x/VoiceFeed.tsx`), lists the newest notes with the sentence that each
author said. "Home" in the app's navigation opens the timeline. The voice
multisig page (`/multisig/`) keeps the page with a small screen and a window
(`Showcase.tsx`).

## The timeline

`src/x/Timeline.tsx` lists the demo post and the posts from
`/api/x/eligible-posts`. It is the first screen of the app: every hash that
is not a post (`#/notes/post/<id>`) shows it. The back arrow of a post page
opens it.

- **A card** shows the post, its note and the state of the note's market:
  no note, a note without a market, open bets, closed bets, or JEV's answer.
  A card opens the post page. Notes, ratings and bets happen there, with the
  same parts as the demo post.
- **Tabs.** "Fresh" shows all posts. "Open markets" and "Decided" show the
  posts with a market in that state.
- **Post ids.** An X post id has 64 bits, and the Seams Wallet refuses a post
  id above 2^53 - 1. `notePostId` in `src/x/xPosts.ts` drops the lowest 10
  bits of the X id. That number is the `post_id` in the notes contract and in
  the hash `#/notes/post/<id>`.
- **Lookup.** `toPost` turns an X post into a `Post` of the app, and
  `registerPosts` in `src/data/posts.ts` adds it to `findPost`. The post page,
  the write dialog and the text that JEV reads (`marketContext`) then work
  for it without a change.
- **Without the route.** `pnpm dev` without the function server shows the
  five example posts of `src/x/fixture.ts`. A build shows the demo post and
  the line "The posts from X are not available now."
- `/timeline-preview.html` is the first design mock, with example notes and
  markets. It is dev only.

## Summary rules and `/api/summary`

`src/summaryRules.ts` ports `summaryRefusal` from the SDK. The Wallet refuses a
summary that breaks it with `summary_not_speakable`:

- 1 to 12 words, at most 120 bytes.
- Letters A to Z only, one space between words. A comma can end a word, and
  one `.`, `!` or `?` can end the summary. No digits, apostrophes, hyphens or links.
- It does not start with "send", "sent" or "sends".

`functions/api/summary.ts` takes `POST { text }` (1 to 280 characters). It asks
NEAR AI for one plain sentence, opens contractions ("don't" → "do not"),
checks the rules, and asks once more if a rule fails. It returns
`{ summary, model }` or `{ error }`. It refuses requests from other origins.

## Deploy to Cloudflare Pages

Ask the project owner before you deploy or add a domain.

With wrangler (direct upload), from `demo/frontend/`:

```bash
pnpm exec wrangler pages project create seams-voice-intents --production-branch main
```

```bash
pnpm exec wrangler pages secret put NEAR_AI_API_KEY --project-name seams-voice-intents
```

```bash
pnpm exec wrangler pages secret put FAUCET_PRIVATE_KEY --project-name seams-voice-intents
```

For the voice multisig, set the six `VOICE_OUTLAYER_*` variables the same way
(`wrangler pages secret put VOICE_OUTLAYER_PAYMENT_KEY …`), with the values of
the Seams staging verify route, and the two admin keys
(`wrangler pages secret put MULTISIG_ADMIN_A_KEY …`, then `MULTISIG_ADMIN_B_KEY`).

```bash
pnpm build:site && pnpm exec wrangler pages deploy dist --project-name seams-voice-intents --branch main
```

Run `wrangler pages deploy` from `demo/frontend/`, so that it finds `functions/`.
`--branch main` makes it the production deployment. Without it, wrangler uses
the git branch, and the page gets a preview origin that staging does not allow.

The live origin is `https://seams-voice-intents.pages.dev`. Seams staging must
allow it (CORS and the project's allowed origins), and also
`http://localhost:5173` for local runs. If Cloudflare gives the project another
`pages.dev` name, staging must allow that name instead.

Build with `demo/frontend/.env.production.local` (or the environment) set to the key of
the project that allows the Pages origin. One deploy ships both pages. Do not
deploy `../../examples/speak-to-pay` alone to the same project: that would
replace the whole site with the Speak to pay page.

The summary route spends NEAR AI credit. For a public link, add a Cloudflare
rate-limiting rule on `/api/summary` (and on the two multisig routes, see
above).

## Files

| Path                             | What it is                                                 |
| -------------------------------- | ---------------------------------------------------------- |
| `src/signer/notesSigner.ts`      | The signer seam and the rating sentences.                  |
| `src/signer/seamsSigner.ts`      | The Seams Wallet signer and the plain-word reasons.        |
| `src/seams/seamsConfig.ts`       | The SeamsWeb configuration.                                |
| `src/notes/`                     | Note types, the contract rule, the RPC store, the balance. |
| `src/summaryRules.ts`            | The spoken summary rules (port of the SDK).                |
| `src/components/`                | Timeline, post page, notes box, modals, setup panel.       |
| `src/data/posts.ts`              | Fictional posts.                                           |
| `functions/api/summary.ts`       | The Cloudflare Pages Function for NEAR AI summaries.       |
| `functions/api/faucet.ts`        | The testnet faucet: one `drip` transaction for an account. |
| `src/faucet/nearTx.ts`           | A small NEAR signer for the functions (Borsh, WebCrypto Ed25519). |
| `src/multisig/`                  | The voice multisig screen, recorder, views, signer and route client. |
| `functions/api/voice-verify.ts`  | Sends a `multisig_propose` voice check to the OutLayer verifier. |
| `functions/api/multisig/approve.ts` | The two admin signers: `approve`, `approve`, `execute`. |
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
