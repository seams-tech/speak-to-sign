# Spoken Notes demo

A Community Notes page in the light style of X. You post a note and rate a
note with your voice, through Seams Speak-to-Sign. Testnet only. The posts
and the accounts are fictional.

- **Post a note.** You type the note. NEAR AI suggests a summary of 12 words
  or fewer. You read the summary aloud. The attested verifier checks the
  speaker and the words. Then the Seams Wallet signs `add_note` on the notes
  contract from your own NEAR account, with no confirm tap.
- **Rate a note.** You say "this note is helpful", "this note is somewhat
  helpful" or "this note is not helpful". The Wallet signs `rate_note`.

Pitch words: **Biometric CAPTCHA** is the voice gate. **Spoken Lease** is the
signed output: one call, for a short time.

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

Open http://localhost:5173. Without `pnpm dev:api`, the page works, but
"Suggest summary" shows an error. You can type the summary yourself.

To run the built site as Cloudflare Pages runs it (page and function on one port):

```bash
pnpm build
pnpm preview   # http://localhost:8788
```

## Scripts

| Script           | What it does                                                         |
| ---------------- | -------------------------------------------------------------------- |
| `pnpm dev`       | Vite dev server with hot reload on port 5173.                        |
| `pnpm dev:api`   | `wrangler pages dev` for `functions/` on port 8788.                  |
| `pnpm build`     | Builds the page into `dist/`.                                        |
| `pnpm preview`   | Serves `dist/` and `functions/` with wrangler on port 8788.          |
| `pnpm typecheck` | Type-checks the page, `vite.config.ts` and the Pages Function.       |

## Settings

Page settings are read at build time. Put them in `demo/.env.local` (see `.env.example`).

| Variable                 | Default                         | Meaning                                                 |
| ------------------------ | ------------------------------- | ------------------------------------------------------- |
| `VITE_NOTES_CONTRACT`    | empty                           | The notes contract account. Empty means **mock mode**.  |
| `VITE_NEAR_RPC_URL`      | `https://test.rpc.fastnear.com` | NEAR testnet RPC for the contract views.                |
| `VITE_NEAR_EXPLORER_URL` | `https://testnet.nearblocks.io` | Explorer for the transaction links.                     |

Function settings are secrets. Put them in `demo/.dev.vars` for local runs, and
in the Cloudflare Pages project for the live site. Never commit `.dev.vars`.

| Variable          | Meaning                                                                 |
| ----------------- | ----------------------------------------------------------------------- |
| `NEAR_AI_API_KEY` | Key for `https://cloud-api.near.ai/v1/chat/completions`. Required.      |
| `NEAR_AI_MODEL`   | Optional. Default `Qwen/Qwen3.8-27B`, a small model that NEAR AI hosts. |

## Mock mode

If `VITE_NOTES_CONTRACT` is empty, the page uses a mock signer and a mock
notes store. They share one in-memory copy of the notes contract. A reload
resets it. The setup panel shows:

- **Mock account**: `alice.testnet`, `bob.testnet` or `carol.testnet`.
- **Next result**: `Sent`, `Refused`, `Cancelled` or `Unavailable` for the next
  sign request. It goes back to `Sent` after one use.

The mock copies the contract rules in `../community-notes/src/lib.rs`:

- A note shows ("Readers added context …") when it has 2 or more `helpful`
  ratings and more `helpful` than `not_helpful` ratings.
- The author cannot rate their own note.
- A later rating from the same account replaces the earlier rating.

To see the full flow, write a note as alice. Then rate it "helpful" as bob
and again as carol. The note then shows on the post and on the timeline.

## The signer seam

The page codes only against `src/signer/notesSigner.ts`:

```ts
type SignResult =
  | { kind: 'sent'; transactionHash: string }
  | { kind: 'refused'; reason: string }
  | { kind: 'cancelled' }
  | { kind: 'unavailable'; reason: string };

interface NotesSigner {
  status(): Promise<{ signedIn: boolean; accountId?: string; voiceReady: boolean }>;
  requestNote(input: { postId: number; text: string; summary: string }): Promise<SignResult>;
  requestRating(input: { noteId: number; rating: 'helpful' | 'somewhat_helpful' | 'not_helpful' }): Promise<SignResult>;
}
```

`src/services.ts` picks the signer. In contract mode it uses
`notConnectedSigner`, which returns `unavailable`. To connect the Seams
Wallet (SDK 0.59.0):

1. Replace `notConnectedSigner` with an adapter over
   `seams.speakToSign.requestNote` and `seams.speakToSign.requestRating`.
2. Map the SDK results to `SignResult`. Give `refused` a reason in plain words.
3. Optional: give `setup` the methods `signIn`, `enableVoice` and `enroll`
   (`SignerSetup` in `notesSigner.ts`). The setup panel then shows a button
   for each step.

`requestNote` gets the summary without end punctuation and with single
spaces. The owner says the sentences in `RATING_SENTENCES` for ratings.

## Notes store

`src/notes/rpcStore.ts` calls the contract views over NEAR JSON-RPC:
`get_notes({ post_id })` and `get_rating({ note_id, account_id })`. Ids are JSON
numbers. After a sent result, the page reads the post again until the new note
or the new counts show.

## Summary rules and `/api/summary`

`src/summaryRules.ts` holds the rules. The page and the function both use it.
Swap it for the SDK check when the SDK exports one.

- 1 to 12 words.
- After you remove end punctuation: letters, spaces and apostrophes only.
- No digits. Write numbers as words.
- No links, handles, `＠`, `#` or hyphens.

`functions/api/summary.ts` takes `POST { text }` (1 to 280 characters). It asks
NEAR AI for one plain sentence, checks the rules, and asks once more if a rule
fails. It returns `{ summary, model }` or `{ error }`. It refuses requests from
other origins.

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
Set `VITE_NOTES_CONTRACT` before `pnpm build` to leave mock mode.

With the Git integration: root directory `demo`, build command `pnpm build`,
output directory `dist`. Add `NEAR_AI_API_KEY` as a secret and the `VITE_*`
variables as build variables.

The summary route spends NEAR AI credit. For a public link, add a Cloudflare
rate-limiting rule on `/api/summary`.

## Files

| Path                             | What it is                                              |
| -------------------------------- | ------------------------------------------------------- |
| `src/signer/notesSigner.ts`      | The signer seam and the rating sentences.               |
| `src/signer/mockBackend.ts`      | Mock signer and mock store with one shared state.       |
| `src/services.ts`                | Picks mock or contract mode. The real signer goes here. |
| `src/notes/`                     | Note types, the contract rule, the RPC store.           |
| `src/summaryRules.ts`            | The spoken summary rules.                               |
| `src/components/`                | Timeline, post page, notes box, modals, setup panel.    |
| `src/data/posts.ts`              | Fictional posts.                                        |
| `functions/api/summary.ts`       | The Cloudflare Pages Function for NEAR AI summaries.    |

## Design rules

- The look copies X's light theme: icon rail, "Post" header, post card, the
  notes box, the "Do you find this helpful? Rate it" row, the modals and the
  blue toast.
- No X logo or wordmark. The logo slot holds a neutral icon.
- No real people or accounts. The posts, the handles and the link domains are fictional.
- System fonts. X's own font is proprietary.
