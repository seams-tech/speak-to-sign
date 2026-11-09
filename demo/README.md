# Spoken Notes demo

A Community Notes page in the light style of X. You post a note and rate a
note with your voice, through Seams Speak-to-Sign. Testnet only. The posts
are fictional.

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

## What must be live

| Part                     | Where                                                        | Status on 9 Nov 2026                                   |
| ------------------------ | ------------------------------------------------------------ | ------------------------------------------------------ |
| Notes contract           | `notes.seams-v1.testnet` (`../community-notes/`)             | Deployed. `get_notes` answers.                         |
| Seams Wallet host        | `https://staging.sign.seams.sh`                              | Speak-to-Sign host API 4: transfers and enroll only.   |
| Seams server (gateway)   | `https://staging.api.wallet.seams.sh`, route `/speak-to-sign/v1/verify` | Notes need verifier 0.4.0 in its settings. |
| Seams Wallet SDK         | `@seams/wallet`, `@seams/voiceid`, `@seams/speak-to-sign`    | This page pins 0.58.0. Notes need 0.59.0.              |

Spoken notes work when all four are ready:

1. Publish SDK 0.59.0. Then in `demo/`:
   `pnpm add @seams/wallet@0.59.0 @seams/voiceid@0.59.0 @seams/speak-to-sign@0.59.0`.
   The page code needs no change: `src/signer/seamsSigner.ts` finds
   `requestNote` and `requestRating` at run time.
2. Deploy the 0.59.0 Wallet host to `staging.sign.seams.sh`, with the
   Speak-to-Sign host plugin of host API 6 (`seams-speak-to-sign-host`).
3. Set the staging gateway's `SPEAK_TO_SIGN_OUTLAYER_VERSION_KEY` to verifier
   0.4.0: `8a0b7ba0dff61a4b45e5d1d164c011525e11fe9f4fd02a4e22368882447329ef`
   (see `../README.md`). Transfers stay the same in 0.4.0.

Until then, sign-in, VoiceID and enroll use the current staging Wallet. "Read it aloud to post" and
"Say it aloud to rate" answer "Speak-to-Sign is not available" with the reason.

## Run it locally

You need Node 22 or later and pnpm 10.

```bash
cd demo
pnpm install
cp .dev.vars.example .dev.vars   # then set NEAR_AI_API_KEY in .dev.vars
```

Start the summary function (terminal 1) and the page (terminal 2):

```bash
pnpm dev:api   # wrangler pages dev on http://localhost:8788 (the /api/summary function)
pnpm dev       # Vite on http://localhost:5173, sends /api/* to port 8788
```

Open http://localhost:5173. To run the built site as Cloudflare Pages runs it:

```bash
pnpm build
pnpm preview   # http://localhost:8788
```

## Set up a wallet (in the page's setup panel)

1. **Sign in to Seams Wallet.** The Wallet's own menu opens: unlock with a
   passkey, or create a wallet. The account is a NEAR testnet account.
2. **Turn on VoiceID.** The Wallet records a few short phrases.
3. **Enroll your voice.** You read three phrases. Then you confirm one signed
   message (NEP-413) that names exactly these recordings. The verifier stores
   your voice template. The page remembers this step in your browser only,
   because the verifier has no status call.
4. **Testnet NEAR for gas.** Each note or rating pays a little gas from your
   account. The panel shows the free balance and links to the faucet.

A note shows on the post ("Readers added context …") when it has 2 or more
`helpful` ratings and more `helpful` than `not_helpful` ratings. The author
cannot rate their own note. So a full demo needs three wallets: the author
and two raters.

## Scripts

| Script           | What it does                                                         |
| ---------------- | -------------------------------------------------------------------- |
| `pnpm dev`       | Vite dev server with hot reload on port 5173.                        |
| `pnpm dev:api`   | `wrangler pages dev` for `functions/` on port 8788.                  |
| `pnpm build`     | Builds the page into `dist/`.                                        |
| `pnpm preview`   | Serves `dist/` and `functions/` with wrangler on port 8788.          |
| `pnpm typecheck` | Type-checks the page, `vite.config.ts` and the Pages Function.       |

## Settings

Page settings are read at build time. The defaults are the Seams staging
testnet lane, the only lane whose Seams server runs the verifier. To change
one, put it in `demo/.env.local` (see `.env.example`).

| Variable                       | Default                               |
| ------------------------------ | ------------------------------------- |
| `VITE_NOTES_CONTRACT`          | `notes.seams-v1.testnet`              |
| `VITE_NEAR_RPC_URL`            | `https://test.rpc.fastnear.com`       |
| `VITE_NEAR_EXPLORER_URL`       | `https://testnet.nearblocks.io`       |
| `VITE_SEAMS_WALLET_ORIGIN`     | `https://staging.sign.seams.sh`       |
| `VITE_SEAMS_RELAYER_URL`       | `https://staging.api.wallet.seams.sh` |
| `VITE_SEAMS_RP_ID`             | `staging.sign.seams.sh`               |
| `VITE_SEAMS_SIGNING_WORKER_ID` | `router-ab-signing-worker-staging`    |

Function settings are secrets. Put them in `demo/.dev.vars` for local runs, and
in the Cloudflare Pages project for the live site. Never commit `.dev.vars`.

| Variable          | Meaning                                                                 |
| ----------------- | ----------------------------------------------------------------------- |
| `NEAR_AI_API_KEY` | Key for `https://cloud-api.near.ai/v1/chat/completions`. Required.      |
| `NEAR_AI_MODEL`   | Optional. Default `Qwen/Qwen3.8-27B`, a small model that NEAR AI hosts. |

## How the page talks to the Wallet

- `src/main.tsx` wraps the app in `SeamsWebProvider` with the configuration
  from `src/seams/seamsConfig.ts`: VoiceID, Speak-to-Sign on testnet, the
  Wallet iframe at `walletOrigin`, the relayer and the Router A/B signing worker.
- `src/signer/notesSigner.ts` is the seam. The UI codes only against it.
- `src/signer/seamsSigner.ts` fills it:
  - `requestNote` → `seams.speakToSign.requestNote({ walletId, contract, postId, text, summary })`
  - `requestRating` → `seams.speakToSign.requestRating({ walletId, contract, noteId, rating })`
  - `enableVoice` → `seams.registration.activateAuthMethod` (or `setAuthMethodEnabled`)
  - `enroll` → `seams.speakToSign.enroll({ walletId })`
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

With wrangler (direct upload), from `demo/`:

```bash
pnpm exec wrangler pages project create speak-to-sign-notes --production-branch main
```

```bash
pnpm exec wrangler pages secret put NEAR_AI_API_KEY --project-name speak-to-sign-notes
```

```bash
pnpm build && pnpm exec wrangler pages deploy dist --project-name speak-to-sign-notes
```

Run `wrangler pages deploy` from `demo/`, so that it finds `functions/`.

With the Git integration: root directory `demo`, build command `pnpm build`,
output directory `dist`. Add `NEAR_AI_API_KEY` as a secret.

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

## Design rules

- The look copies X's light theme: icon rail, "Post" header, post card, the
  notes box, the "Do you find this helpful? Rate it" row, the modals and the
  blue toast.
- No X logo or wordmark. The logo slot holds a neutral icon.
- No real people or accounts in the posts. The posts, the handles and the link
  domains are fictional.
- System fonts. X's own font is proprietary.
