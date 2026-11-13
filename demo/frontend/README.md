# Speak-to-Sign demo site

This folder builds two pages on one origin, `https://speak-to-sign.pages.dev`,
live on NEAR testnet. Both use the same Seams project, so one wallet works on
both.

- `/` (`index.html`): Community Notes. A hero says what a spoken approval is
  and has the setup steps. The notes app is on a sheet under the hero. The
  page style follows the Seams Wallet site. Its code is in `src/showcase/`
  ([the page](src/showcase/README.md)) and `src/x/`
  ([the posts and the timeline](src/x/README.md)).
- `/multisig/` (`multisig/index.html`): the spoken multisig, version 3.0.0 of
  `../contracts/voice-multisig` (`config.multisigContract`,
  `VITE_MULTISIG_CONTRACT`). A signer types a transfer and reads it aloud; each
  other signer says it from memory; the proposer's browser executes it. The
  Seams Wallet signs `propose`, `approve` and `execute` with its normal confirm
  step. Its code is in `src/multisig/` (`MultisigPage.tsx`).

## The voice route (`/api/voice-verify`)

The multisig page records the microphone in the page
(`src/voice/recorder.ts`): a 16 kHz mono PCM16 WAV of at most 8 s. The page
sends it to `/api/voice-verify` (`functions/api/voice-verify.ts`), which calls
the OutLayer verifier. The route takes only three request kinds:
`multisig_propose`, `multisig_confirm` and `market_bet`. The site does not use
`market_bet`: a bet, a note and a rating are spoken requests of the Seams
Wallet, and the Wallet calls the Seams verify route. Only the dev page
`/market-preview.html?voice` sends `market_bet`. The route needs the `VOICE_OUTLAYER_*` variables (see Settings). They take effect at the next
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

### The speech-to-text service

The verifier has two builds (`crates/voice-verifier/README.md`,
"Speech-to-text service"). The default build sends the words to NEAR AI
Whisper, sealed to a gateway whose TDX quote it checked. The `venice` build
sends them to Venice AI, which has no TEE: Venice can read the audio. Each
build has its own WASM hash, and the route selects one for each call with
the `version_key`:

- A request can name the service: `{ "input": { ... }, "transcriber":
  "nearai" }` or `"venice"`.
- With no name, NEAR AI serves the call. Venice serves it only while NEAR AI
  or its Whisper is down. The route uses the check of `/api/near-ai-status`
  and waits at most 3 s for it; no answer in that time counts as down.
- Venice needs `VOICE_OUTLAYER_VENICE_VERSION_KEY`. Without it, each call
  goes to NEAR AI, and a request that names Venice gets a 503.
- The answer names the service in the header `X-Speech-To-Text`. The verdict
  of a Venice call has a `verifier` that ends in `+venice`.

The page does not select the service: only this server holds the two hashes.

## The NEAR AI warning (`/api/near-ai-status`)

The verifier sends each recording to NEAR AI's Whisper
(`openai/whisper-large-v3`). When Whisper is down, every voice check fails.
On 12 Nov 2026 Whisper failed for about an hour, while the rest of NEAR AI
answered. So the nav of each page shows a warning while NEAR AI or Whisper is
down, or while Whisper is slow (`src/components/NearAiWarning.tsx`). A phone
shows the icon only; a tap opens the sentence.

The page asks `/api/near-ai-status` (`functions/api/near-ai-status.ts`) when
it opens and each minute. The route asks the NEAR AI model list and sends
Whisper a silent clip of 0.5 s. An answer after 5 s is slow; no answer in
10 s or a 5xx answer is down. A 4xx answer (a bad key, a rate limit) shows no
warning. Each worker keeps one result for one minute, so the page views do
not each pay for a transcription.

## Community Notes

A Community Notes page in the style of X. You post a note and rate a note
with your voice, through Seams Speak-to-Sign. Testnet only. The posts are real
posts from X where people asked for a Community Note. They are about science,
technology, business or politics. Posts about sport, entertainment, health,
war, crime or adult content do not show.

- **Say a command.** In the voice bar, you say what to do, for example "bet
  one dollar on no on the second note". JEV, an AI classifier (`functions/api/voice-command.ts`,
  [the voice commands](src/voice/README.md)), turns the words into a command: the
  post, the side and the amount. The command opens the bet sheet, a note or
  a rating. JEV never proposes or signs a payment. You approve the exact bet
  when you say its sentence.
- **Post a note.** NEAR AI drafts the note for each post, and you can change
  it. The write dialog says "Drafted by NEAR AI" under a note that the model
  wrote. The Seams server writes a summary of 12 words or fewer. You read
  the summary aloud in the Seams Wallet card. The attested
  verifier checks the speaker and the words. Then the Seams Wallet signs
  `add_note` on the notes contract from your own NEAR account, with no
  confirm tap.
- **Rate a note.** You say "this note is helpful", "this note is somewhat
  helpful" or "this note is not helpful". The Wallet signs `rate_note`.

There is no mock. Every note and rating is a real transaction on NEAR testnet,
signed by the real Seams Wallet after the real verifier accepts your voice.

## What must be live

The notes contract, the Seams Wallet host, the Seams server and the verifier.
[`docs/deployed-state.md`](../../docs/deployed-state.md) lists each one with its
version and the command that checks it. Two facts belong to this page:

- `package.json` pins the versions of `@seams/wallet`, `@seams/voiceid` and
  `@seams/voice-verdict`. The Wallet host must run the same version.
- The Seams project is in the staging Seams Console, with the publishable key
  `seams-voice-intents`. It allows the Pages origin, `https://localhost:5443`
  and `https://localhost:8443`.

## Run it locally

You need Node 22 or later and pnpm 10.

```bash
cd demo/frontend
pnpm install
cp .dev.vars.example .dev.vars   # then set NEAR_AI_API_KEY in .dev.vars
cp .env.example .env.local       # then set the VITE_SEAMS_* key and environment (ask the project owner)
```

Start the functions, the page and the HTTPS proxy with one command, from the root of the
repository:

```bash
pnpm site        # installs the packages if needed, starts all three, prints the address to open
```

`pnpm site` (`scripts/site.mjs`) uses a server that runs already on its port, starts Vite with
`--force` (so a new SDK version always replaces Vite's cached copy), and Ctrl+C stops the
servers that it started. To run them one by one instead, each in its own terminal:

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
pnpm build:site   # demo/frontend/ into dist/
pnpm preview      # http://localhost:8788
```

`build:site` (`scripts/build-site.mjs`) stops if `VITE_SEAMS_PUBLISHABLE_KEY`
is not set. Then it runs the same build as `pnpm build`.
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
   on the note market pays USDC (1 USDC or more). After sign-in the page asks
   the demo's faucet (`/api/faucet`) by itself: in one transaction it sends
   0.2 NEAR and 2 USDC, once per account. A new wallet is an implicit account,
   and the faucet's NEAR puts it on testnet. Each network (IP address) gets the
   faucet for 3 accounts. The faucet is a small contract on
   `seams-faucet.testnet` (`../contracts/faucet/`). If the faucet refuses or is
   empty, the step links to the public NEAR and USDC (faucet.circle.com)
   faucets.

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
| `pnpm build:site`| The build for a deploy: `pnpm build`, but only with the Seams key set. |
| `pnpm preview`   | Serves `dist/` and `functions/` with wrangler on port 8788.          |
| `pnpm dev:https` | Caddy with local HTTPS: https://localhost:5443 and :8443.            |
| `pnpm typecheck` | Type-checks the page, `vite.config.ts` and the Pages Function.       |
| `pnpm test`      | Unit tests (`node --test tests/*.test.ts`): the WAV and the resampling, the voice routes and voice commands, the bet and note transactions, the faucet limit, and the X posts. |

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
| `VITE_MULTISIG_CONTRACT`            | `voice-multisig-2.seams-v1.testnet`   |
| `VITE_NEAR_RPC_URL`                 | `https://test.rpc.fastnear.com`       |
| `VITE_NEAR_EXPLORER_URL`            | `https://testnet.nearblocks.io`       |
| `VITE_VOICE_AUDIO_KEY`              | none: recordings go as plain WAVs     |

With `VITE_VOICE_AUDIO_KEY` (standard base64 of the verifier's 32-byte audio
key), the multisig page seals each recording to the
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
| `NEAR_AI_API_KEY` | Key for NEAR AI: the chat model of the draft notes, and JEV (`/v1/systemone`) for the subject filter and the voice commands without `TYPESAFE_API_KEY`. `/api/near-ai-status` uses it to check NEAR AI and Whisper. Required. |
| `TYPESAFE_API_KEY` | Optional. Key for JEV at Typesafe: the subject filter and the voice commands use it in place of NEAR AI. |
| `NEAR_AI_MODEL`   | Optional. The chat model of the draft notes. Default `Qwen/Qwen3.8-27B`, a small model that NEAR AI hosts. |
| `FAUCET_PRIVATE_KEY` | The faucet's function-call key (`ed25519:…`). It can call `drip` on `seams-faucet.testnet` and nothing else. Each drip uses about 0.008 NEAR of its gas allowance. Required for `/api/faucet`, with the KV binding `FAUCET_LIMITS` of `wrangler.toml`. |
| `FAUCET_ACCOUNT`  | Optional. Default `seams-faucet.testnet`.                               |
| `NEAR_RPC_URL`    | Optional, for `/api/faucet`. Default `https://test.rpc.fastnear.com`. |
| `X_API_KEY`, `X_API_SECRET` | Secret. The OAuth 1.0a Consumer Key and secret of the X app of a Community Notes AI Note Writer account. Required for `/api/x/eligible-posts`. |
| `X_ACCESS_TOKEN`, `X_ACCESS_TOKEN_SECRET` | Secret. The OAuth 1.0a Access Token and secret of the same account. Required. A Bearer Token does not work on this endpoint. |
| `X_ELIGIBLE_MAX`  | Optional. Posts for each call to X, 1 to 100. Default 10; `wrangler.toml` sets 30. |
| `X_ELIGIBLE_KEEP` | Optional. The most posts that the snapshot keeps, 10 to 2000. Default 600. |
| `X_ELIGIBLE_TTL_SECONDS` | Optional. The route asks X again after this time. Default 28800 (8 hours), minimum 60. |
| `X_ELIGIBLE_LANG` | Optional. A language code such as `ja`, or `all`. X's default is English. |
| `X_ELIGIBLE_TOPICS` | Optional. The subjects that `/api/x/eligible-posts` shows, as a comma list. Default `science,technology,business,politics`. `all` turns the filter off. The filter needs a JEV key: `TYPESAFE_API_KEY` or `NEAR_AI_API_KEY`. |
| `VOICE_OUTLAYER_BASE_URL` | For `/api/voice-verify`. The OutLayer API, for example `https://testnet-api.outlayer.ai` (`*.outlayer.fastnear.com` is retired). |
| `VOICE_OUTLAYER_PROJECT` | `owner/project` of the verifier, as in the Seams staging verify route. |
| `VOICE_OUTLAYER_VERSION_KEY` | The WASM hash of the verifier version that the route calls. |
| `VOICE_OUTLAYER_VENICE_VERSION_KEY` | Optional. The WASM hash of the `venice` build of the same verifier. See "The speech-to-text service" above. |
| `VOICE_OUTLAYER_PAYMENT_KEY` | Secret. The OutLayer payment key of the Seams staging verify route. Another key finds no voice templates. |
| `VOICE_OUTLAYER_SECRETS_PROFILE` | The secrets profile of the Seams staging verify route. |
| `VOICE_OUTLAYER_SECRETS_ACCOUNT_ID` | The secrets account of the Seams staging verify route. |

Without the `VOICE_OUTLAYER_*` variables, `/api/voice-verify` answers 503 with
the names of the missing variables, and the multisig page shows that text.

## How the page talks to the Wallet

- `src/showcase/main.tsx` wraps the page in one `SeamsWebProvider` with the configuration
  from `src/seams/seamsConfig.ts`: `seamsTestnetConfig` with the publishable
  key, VoiceID, and Speak-to-Sign on testnet. The SDK derives the passkey
  RP ID (the Wallet host) and the Router A/B signing worker from the Wallet origin.
- `src/signer/notesSigner.ts` is the seam. The UI codes only against it.
- `src/signer/seamsSigner.ts` fills it with the typed SDK calls (0.70.4, `seams.near.spoken`):
  - `requestNote` → `seams.near.spoken.note({ walletSession, contract, postId, text })`
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
4. The Wallet card shows "Note posted" with a TEE receipt: the voice, the words,
   the summary check and the verifier version of the signed verdict, and a link
   to the TDX quote of the OutLayer call. Its Done closes the card, and the
   page's dialog closes with it. The page shows no result of its own.

The verifier README says how the check works and who writes the summary:
[Note summary check](../../crates/voice-verifier/README.md#note-summary-check).

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

For the multisig page, set the `VOICE_OUTLAYER_*` variables the same way
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
`https://localhost:5443` and `https://localhost:8443` for local runs. If Cloudflare gives the project another
`pages.dev` name, staging must allow that name instead.

Build with `demo/frontend/.env.production.local` (or the environment) set to the key of
the project that allows the Pages origin. Do not deploy
`../speak-to-pay` to the same project: that would replace the
whole site with the Speak to pay page.

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
| `src/data/posts.ts`              | The post type, and the lookup of the posts from X by id.   |
| `functions/api/faucet.ts`        | The testnet faucet: one `drip` transaction for an account. |
| `src/faucet/nearTx.ts`           | A small NEAR signer for the functions (Borsh, WebCrypto Ed25519). |
| `src/voice/recorder.ts`, `wav.ts` | The microphone recorder and the verifier's WAV.            |
| `functions/api/voice-verify.ts`  | Sends a voice check of the multisig page (`multisig_propose`, `multisig_confirm`) to the OutLayer verifier. |
| `src/multisig/`                  | The spoken multisig page: views, verifier call, Wallet calls, the page. |
| `functions/lib/http.ts`          | The parts that the functions share: same origin, body size, JSON. |
| `tests/`                         | Unit tests (`pnpm test`).                                  |
| `src/showcase/`                  | The page at `/`: the nav, the hero, the sheet, the themes ([README](src/showcase/README.md)). |
| `src/x/`                         | The posts from X, the timeline and the draft notes ([README](src/x/README.md)). |
| `src/market/`                    | The note market strip and its bet sheet ([README](src/market/README.md)). |
| `src/voice/` (other files)       | The voice bar and the voice commands ([README](src/voice/README.md)). |
| `src/dev/`, `*-preview.html`     | Dev pages, not in the build: `/market-preview.html` (the market with mock data), `/timeline-preview.html` (the first design mock), `/card-flow-preview.html` and `/card-minimize-preview.html` (the Wallet voice card from the local `packages/voice-capture` build). |

## Design rules

- The look copies X: its light theme in Light mode and Lights out in Dark mode. It has the icon rail, "Post" header, post card, the
  notes box, the "Do you find this helpful? Rate it" row, the modals and the
  blue toast.
- No X logo or wordmark. The logo slot holds a neutral icon.
- The posts are real posts from X (`src/x/xPosts.ts`). The page does not
  invent reply, repost, like or view counts.
- System fonts. X's own font is proprietary.
