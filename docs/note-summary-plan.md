# Plan: the Seams server writes the note summary, and the TEE checks it

Status: decided on 2026-11-12. Released in 0.69.0 on 2026-11-12: verifier 0.13.0 (`1b777154…`) on OutLayer, Seams Wallet 0.69.0, and the demo.

## The problem

To sign a community note, the author says a short summary of the note aloud. Today the app
writes this summary (the demo calls its own route `/api/summary`) and gives it to the Seams
Wallet. The verifier checks that the voice said the summary. It does not check that the summary
describes the note. So an app can show one note, sign another note, and give a summary that fits
the note on the screen.

## The decisions

1. The Seams server writes the summary from the note text. The app does not give a summary.
2. The writer is `Qwen/Qwen3.8-27B` on NEAR AI, with
   `chat_template_kwargs: { enable_thinking: false }`. Without this flag, the model thinks for a
   long time and often gives no text.
3. The author says the summary. The verifier checks the voice and the words, as before.
4. The verifier (the TEE) asks JEV "Does this summary give the main point of this note?". JEV is
   `typesafe/jev-1.13` on the NEAR AI `systemone` route. JEV cannot write text: it only answers
   questions, so it checks and Qwen writes.
5. The verifier gets the note text, not only its hash. It calculates `note_sha256` itself, so
   the hash in the signed request is the hash of the text that JEV read.
6. If the fit is less than 600 thousandths, the verifier refuses with `summary_mismatch`. If
   JEV does not answer, the verifier refuses with `summary_check_unavailable`.
7. The "send" rule stays. A summary cannot start with "send", "sent" or "sends". The Seams server
   checks each summary against the spoken rules of `SpokenSummary`. If a summary breaks a rule,
   the server asks the model again. The author never sees this rule.
8. The voice card shows the note text and the summary in one card, above the voice line.
9. The demo removes its summary route and its phrase field.

## Why the "send" rule stays

The rule exists because the word rules read a sentence that starts with "send" as a payment.
They change "to" to "two", add "near" after an amount, and look for a recipient. A note summary
that starts with "send" can then give other words than the author said.

The rule was a problem only when the author typed the summary. Now the server writes it, so the
server can rephrase. To remove the rule for notes, we must add a note summary type to
`spoken-intent`, change the word check of the verifier, change the test vectors, and build and
deploy the notes contract again. That cost does not give the author a better result.

## Measurements

The writer, on 3 notes:

| Model | Time | Price (input / output, per 1M tokens) |
|---|---|---|
| `Qwen/Qwen3.8-27B`, thinking off | 0.47 to 1.0 s | $0.04 / $1.35 |
| `Qwen/Qwen3.6-35B-A3B-FP8` | 0.41 to 0.45 s | $0.17 / $1.10 |
| `gemini-2.5-flash-lite` | 0.7 s | |
| `claude-haiku-5-5` | 1.0 to 1.4 s | |

One summary costs approximately $0.00002 with Qwen3.8-27B.

The checker (JEV, approximately 0.3 s):

| Summary | Fit (thousandths) |
|---|---|
| A fair summary | 680 to 940 |
| A summary of another note, or the opposite claim | 480 or less |
| A generic summary ("this is a note") | 410 to 690 |

The limit is 600.

## The steps

1. Verifier crate (TEE). Take the note text, check its hash, run the JEV check, and add the
   refusals. This is one new verifier build (0.13.0). A deploy to OutLayer needs the owner's
   approval.
2. Seams Wallet.
   - A summary route on the Seams server that calls NEAR AI with Qwen, and checks the spoken
     rules.
   - The SDK calls this route. `spoken.note` no longer takes `summary` from the app.
   - The Wallet sends `note_text` to the verifier, not `note_sha256_hex`.
   - The voice card shows the note text and the summary.
3. Demo. Remove `functions/api/summary.ts`, `src/api/summary.ts`, the phrase field and the
   summary rules. Move to the Seams release that has step 2.

## State on 2026-11-12

The code of the three steps is in the working trees. Nothing is committed, built for OutLayer,
published or deployed.

- Verifier 0.13.0 (`crates/voice-verifier`): the note text, the JEV check, the two refusals,
  the shared vectors at 0.13.0. All tests pass. The local WASM build works (548,982 bytes).
- `@seams/voice-capture`: `openPhraseCard({ context: { label, text } })` shows the note above
  the sentence. The card rows now have names, so a host that sets its own rows must use the
  names (`unlockFrame.ts` in VoiceID sets rows without names: change it with the version bump).
- seams-wallet: the route `POST /speak-to-sign/v1/summary` (env `SPEAK_TO_SIGN_NEAR_AI_API_KEY`,
  optional `SPEAK_TO_SIGN_SUMMARY_MODEL`), `spoken.note` without `summary`, the unavailable
  reason `summary_unavailable`, the iframe protocol 25.0.0, and the card context. Type check,
  258 unit tests and the bloat check pass. VoiceID passes `context`, but the card shows it only
  with the new voice-capture version.
- Demo: no summary route, no phrase field, drafts without a sentence. It type-checks against
  the local SDK build, not against SDK 0.68.0 from npm.

## The order of the release

The verifier input changes (`note_text` in place of `note_sha256_hex`). So the new verifier and
the new Wallet go live together. The notes contract 1.1.0 already checks the signed verdict, and
it calculates `note_sha256` from the note text. It needs no change.
