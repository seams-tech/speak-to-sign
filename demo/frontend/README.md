# Speak-to-Sign demo site

The site is one page (`/`): what a spoken approval is, and the applications as
small screens in hand-drawn frames. A click on a screen grows it into a window
of about 90% of the screen, and the app in it works. Community Notes is live
(`#/notes`); the pull request merge (`#/merge`) works up to the Wallet call; the
voice multisig (`#/multisig`) works against its testnet contract, and shows
example data until the contract is deployed. The page style follows the
Seams Wallet site. Its code is in `src/showcase/`.

Each live app renders once (`src/showcase/live.tsx`), and its element moves
between its small screen and the window, so the app keeps its page, sign-in
and data. The notes app scrolls itself, and its layout follows the window size
(container queries), not the screen size.

## PR merge by voice (on `/`)

The pull request example on the Speak-to-Sign page is live. Its screen,
`LiveMergeScreen` in `src/merge/`, draws the same pull request page as the
other examples, but **Merge with voice** works: the owner says "merge pull
request four hundred twelve into main", the verifier checks the voice and the
words, and the Seams Wallet signs `approve_merge` on the merge approvals
contract (`../contracts/merge-approvals/`, proposed account
`github.seams-v1.testnet`). Nothing in a repository changes; the on-chain
approval is the signed merge message. The screen lists the newest approvals
that the contract holds.

It waits for two things. The contract must be deployed. The Wallet must have
the new spoken request kind and `seams.speakToSign.requestMergeApproval`
(`merge-approval-spec.md` in the session notes). Until then the button
answers with the reason.

## Voice multisig (`#/multisig`)

A NEAR multisig where each approval is a spoken intent, not a click. The spec
is `../../docs/voice-multisig.md`. The screen, `LiveMultisigScreen` in
`src/multisig/`, draws a transaction queue and works on NEAR testnet against
the contract in `VITE_MULTISIG_CONTRACT` (default `team.seams-v1.testnet`,
`../contracts/voice-multisig/`).

- **Propose.** The proposer types a receiver and an amount (0.01 to 1,000,000
  NEAR, whole hundredths), and reads "Approve proposal 8: send 25 NEAR to
  grants.testnet" aloud. The verifier keeps the transfer and returns a salted
  commitment. The Wallet signs `propose`; the chain gets only the commitment.
  The page then says "Tell the other members: send 25 NEAR to grants.testnet",
  and keeps the opening (receiver, amount, salt, commitment) in this browser's
  `localStorage`.
- **Confirm.** Another member opens the proposal. The page shows "Approve
  proposal 8: send ___ NEAR to ___". The member says the amount and the
  receiver from memory, the verifier checks the voice and the words against the
  stored proposal, and the Wallet signs `confirm`. On a `words` refusal the page
  shows what the verifier heard, never the expected words. A member has three
  tries for each proposal, and a voice that already approved it is refused.
- **Execute.** At the threshold, the proposer's browser, which holds the salt,
  signs `execute`. Members who confirmed see "The proposer executes it once 2 of
  3 have confirmed." If the proposer's browser loses the salt, the proposal
  cannot execute: propose it again.

The page records the microphone itself (`src/multisig/recorder.ts`): a 16 kHz
mono PCM16 WAV of at most 8 s, with Stop and an automatic stop at 8 s. It sends
it to `/api/voice-verify` (`functions/api/voice-verify.ts`), which calls the
OutLayer verifier. The Wallet signs each contract call as a normal function
call (0 NEAR, 30 Tgas; `execute` 50 Tgas) with its passkey confirm step. The
verdict is valid for two minutes, so confirm in the Wallet soon after the
check.

If the contract view fails because the account or its code is missing, the
screen shows example data with the note "Contract not deployed yet", and
nothing records.

### What it needs live

Each deploy is the project owner's decision.

| Part | What | Note |
| --- | --- | --- |
| Contract | `team.seams-v1.testnet`, built from `../contracts/voice-multisig/` | `new` with the members, the threshold and the verifier key `ed25519:E8E53ydtc9LRvVz9xBCRrSzyBa5nh1gK1ts53Aoo751U`. Fund it with a plain transfer. |
| Verifier | An OutLayer verifier version with `multisig_propose` and `multisig_confirm` (0.6.0 or later) | The active version does not know these kinds. Its WASM hash goes in `VOICE_OUTLAYER_VERSION_KEY`. |
| Pages secrets | The six `VOICE_OUTLAYER_*` variables (see Settings) | The same payment key, project and secrets profile as the Seams staging verify route. |

**Why the same OutLayer payment key.** Over HTTPS, OutLayer derives the
verifier's storage cell and its verdict signing key from the owner of the
payment key. The members enrolled their voices through the Seams staging
server, so their templates are in the cell of the Seams payment key. With any
other payment key, every verify refuses `template_missing`, and the verdicts
carry a key that the contract does not pin. The page shows that refusal as
"This account has no voice on this verifier".

The Seams verify route checks that the caller owns `owner`; this route cannot.
The voice check and the contract's predecessor check still bind each verdict to
the owner's voice and key. Each call spends OutLayer credit, so add a
Cloudflare rate-limiting rule on `/api/voice-verify` for a public link.

### Try it with two accounts

1. Use two browser profiles (or two browsers), so each has its own Seams
   Wallet sign-in and its own `localStorage`.
2. In each profile, sign in with a different wallet whose account is a member
   of the contract, and use **Set up your voice** in the setup card. Each
   member must enroll with their own voice.
3. Profile A: open the multisig window, **New proposal**, type `grants.testnet`
   and `0.1`, press **Record**, read the sentence, then confirm in the Wallet.
   Tell the other person the transfer by another channel.
4. Profile B: open the proposal in **Queue**, press **Confirm by voice**, and say
   "approve proposal 8, send zero point one NEAR to grants dot testnet" from
   memory. Confirm in the Wallet.
5. With a threshold of 2, profile A now shows **Execute**. It sends the NEAR.

The two members must be two different people: the verifier refuses a second
approval in a voice that already approved the proposal.

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

The site has two pages on one origin, `https://seams-voice-intents.pages.dev`:
the Speak-to-Sign page at `/` (`index.html`, with Community Notes and the PR
merge in its windows), and the Speak to pay example
(`../../examples/speak-to-pay`) at `/pay/`. Both use the same Seams project, so
one wallet works on both.

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

Open https://localhost:5443 for the Speak-to-Sign page, and
https://localhost:5443/#/notes for the Community Notes window. Passkeys in the Wallet iframe need the app on
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
| `pnpm test`      | Unit tests of the WAV, the resampling and the amount rules (`node --test`). |

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
| `VITE_MULTISIG_CONTRACT`            | `team.seams-v1.testnet`               |
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
| `NEAR_RPC_URL`    | Optional, for `/api/faucet`. Default `https://test.rpc.fastnear.com`.   |
| `VOICE_OUTLAYER_BASE_URL` | For `/api/voice-verify`. The OutLayer API, for example `https://api.outlayer.fastnear.com`. |
| `VOICE_OUTLAYER_PROJECT` | `owner/project` of the verifier, as in the Seams staging verify route. |
| `VOICE_OUTLAYER_VERSION_KEY` | The WASM hash of a verifier version with the multisig kinds (0.6.0 or later). |
| `VOICE_OUTLAYER_PAYMENT_KEY` | Secret. The OutLayer payment key of the Seams staging verify route. Another key finds no voice templates. |
| `VOICE_OUTLAYER_SECRETS_PROFILE` | The secrets profile of the Seams staging verify route. |
| `VOICE_OUTLAYER_SECRETS_ACCOUNT_ID` | The secrets account of the Seams staging verify route. |

Without the `VOICE_OUTLAYER_*` variables, `/api/voice-verify` answers 503 with
the names of the missing variables, and the multisig screen shows that text.

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
the Seams staging verify route.

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
rate-limiting rule on `/api/summary`.

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
| `src/faucet/nearTx.ts`           | A small NEAR signer for it (Borsh, WebCrypto Ed25519).     |
| `src/multisig/`                  | The voice multisig screen, recorder, views and signer.     |
| `functions/api/voice-verify.ts`  | Sends a multisig voice check to the OutLayer verifier.     |
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
