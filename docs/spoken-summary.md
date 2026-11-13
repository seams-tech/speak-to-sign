# The spoken summary

A person approves a long text, such as a community note, by saying one short
sentence: the summary. This page says who writes the summary, which rules it
follows, who checks it, and how a page gets it fast.

The rules of the request and of the word check are in
[`voice-intents-spec.md`](voice-intents-spec.md). This page links to them.

## Why a summary

A note has up to 280 characters. A person cannot say it word for word in one
8 s recording, and speech-to-text cannot write it back letter for letter. So
the person says a summary of 1 to 12 plain words. The verdict binds the
summary and the SHA-256 of the full text
([spec 3, "Requests"](voice-intents-spec.md#3-requests)).

## The parts

| Step | Part | Code |
| --- | --- | --- |
| 1. Write | A server asks a chat model for the summary | `writeSummary` in [`packages/voice-sign/src/summaryWriter.ts`](../packages/voice-sign/src/summaryWriter.ts) |
| 2. Check the form | Code checks the summary against the rules | `summaryRefusal` in [`packages/voice-verdict/src/summary.ts`](../packages/voice-verdict/src/summary.ts) |
| 3. Keep | The page or the Wallet keeps the summary of each text | `createSummarySource` in [`packages/voice-sign/src/summary.ts`](../packages/voice-sign/src/summary.ts) |
| 4. Say | The person reads the summary aloud | The voice card |
| 5. Verify | The verifier checks the words, and for a note the meaning | [`crates/voice-verifier`](../crates/voice-verifier/README.md) |

The three libraries need no wallet. Seams Wallet uses them: see
["How Seams Wallet uses it"](#how-seams-wallet-uses-it).

## The rules of a summary

A summary is 1 to 12 words of the letters A to Z, with one space between two
words, and at most 120 bytes. A word can end with a comma, and the summary
can end with one `.`, `!` or `?`. It cannot start with "send", "sent" or
"sends", because those words start the transfer sentence.

The rules exist because of step 5. Speech-to-text writes a said number, an
apostrophe or a hyphen in more than one way. The verifier needs words that it
can compare one for one.

The Rust type `SpokenSummary` of the verifier is the home of the rules
([`crates/spoken-intent/src/summary.rs`](../crates/spoken-intent/src/summary.rs)).
`summaryRefusal` is its TypeScript port, with the same refusals: `empty`,
`too_long`, `too_many_words`, `character` and `transfer_verb`.

## Who writes the summary

A server writes it, not the page. A page that gives the summary can put other
words in the person's mouth.

`writeSummary(config, text, { signal })` does these steps:

1. It asks a chat model for one sentence. The default is `Qwen/Qwen3.8-27B`
   on NEAR AI Cloud, with thinking off. One request took about 0.45 s on
   2026-11-13.
2. It cleans the reply: it removes thinking text, a label and quotes, opens
   contractions ("can't" becomes "cannot"), and removes commas and hyphens.
3. It checks the result with `summaryRefusal`.
4. If the only fault is a name with a number in it, it keeps the letters of
   that name at once: "COP31" becomes "COP". It makes no second request.
5. For another fault, it asks one second time. That request names the broken
   rule or the word.
6. If the second reply still has a wrong character, it keeps the letters of
   each word. A number that stands alone holds a value, so it does not go:
   the result is then `summary_not_speakable`.

### Why code repairs the reply

The request tells the model "No digits. Write numbers as words." A model does
not follow a format rule each time. For a note that named "COP31", the model
wrote "COP31" in 3 of 3 first replies, and again after a second request that
named only the rule. Before the repair, that note got no summary.

### Why a name loses its number

A number alone reads the same in words: "31" and "thirty one" give the same
words in the verifier. A number inside a name does not. If the summary said
"COP thirty one", speech-to-text often writes the said words as "COP31"
again. The verifier reads a word with a letter and a digit one character at a
time ("cop three one"), as it reads an account name
(`is_account_token` in
[`crates/spoken-intent/src/punctuated/text_step.rs`](../crates/spoken-intent/src/punctuated/text_step.rs)).
"three one" is not "thirty one", so the word check can refuse a correct
reading. So the writer removes the number, and its second request asks the
model to leave such a number out.

### Failure codes

| Code | Meaning |
| --- | --- |
| `summary_unreachable` | The request to the model did not complete (network, timeout, or the caller's `signal`). |
| `summary_failed` | The model answered with an error or with no text. |
| `summary_not_speakable` | Two replies broke a rule, and the repair did not help. |

The codes hold no text of the model and no key.

## Who checks the summary

A summary is a draft. No signature covers it. These checks apply:

| Check | Who | For which request |
| --- | --- | --- |
| The form (the rules above) | `writeSummary`, the summary source, Wallet core, and the verifier | Each request with a summary |
| The spoken words are the summary | The verifier, in the TEE ([spec 7.2](voice-intents-spec.md#72-word-check)) | Each request with a summary |
| The summary gives the main point of the text | The verifier asks JEV, in the TEE ([`summary_check.rs`](../crates/voice-verifier/src/summary_check.rs)) | A community note only |
| The meaning | The person who reads the sentence | Each request |

For a request that is not a community note, the person who reads the
sentence is the one check of its meaning. So a page must show the text with
the sentence. The refusals `summary_mismatch` and `summary_check_unavailable`
are in [spec 8.1](voice-intents-spec.md#81-refusal-reasons).

## How a page gets the summary fast

The request for a summary takes 0.5 to 2 s. A page that asks only at the
press of the button shows nothing for that time. `createSummarySource` lets a
page ask early:

```ts
import { createSummarySource } from '@seams/voice-sign/summary';

const summaries = createSummarySource({
  write: (text, signal) => askYourServer(text, signal),
});
summaries.prepare(noteText);                  // when the text is ready
const result = await summaries.get(noteText); // at the press
```

The source has these rules:

- **One summary for each exact text.** It keeps a summary for 5 minutes
  (`lifeMs`), for at most 8 texts (`maxEntries`). A second try shows the same
  sentence. A changed text gets its own summary.
- **Only a good summary stays.** A failure is not kept, so the next call asks
  again. A summary that breaks a rule is a failure
  (`summary_not_speakable`).
- **A changed text ends the old request.** A new `prepare` ends an older
  request that only `prepare` started and that no `get` waits for. A person
  who edits a text leaves one request, not one for each pause.
- **An aborted `get` ends only its own wait.** The request goes on for the
  next caller.

## How Seams Wallet uses it

- **The server route.** `POST /speak-to-sign/v1/summary` of the Seams server
  calls `writeSummary`. The route reads the Wallet Session, applies the rate
  limit for each wallet, and takes `{ text }` of 1 to 280 characters. It
  exists only with the setting `SPEAK_TO_SIGN_NEAR_AI_API_KEY`.
- **The Wallet frame.** The Wallet keeps one summary source for each owner
  account. Only the Wallet holds the session that the route needs, so the
  page cannot ask the route itself. The page gives the note, never the
  summary.
- **The page.** `seams.near.spoken.prepare({ note: { text } })` tells the
  Wallet that a note comes. The Wallet loads its Speak-to-Sign code and
  starts the summary. It shows no card and signs nothing. `spoken.note` with
  the same text then finds the summary.
- **Wallet core.** Before it builds the request, core checks the summary with
  `summaryRefusal` again. Without a summary, the result is `unavailable` with
  `summary_unavailable`, and no card opens.

The demo's note form calls `prepare` 400 ms after the draft is known, and
again when the text changed and stayed the same for 400 ms
([`WriteNoteModal.tsx`](../demo/frontend/src/components/WriteNoteModal.tsx)).

The summary is not the note draft. In the demo, a model also drafts the note
text itself ("Drafted by NEAR AI"), and the person can change that draft. The
summary is the sentence that the person says for the final text.

## Limits

- English only.
- The summary model has no TEE check, and its text has no signature. A wrong
  summary of a community note is caught by JEV. For another request, only
  the person catches it.
- A name loses its number, so two texts that differ only in that number
  ("COP30" and "COP31") can get the same summary. The verdict still binds
  the SHA-256 of the full text.
- JEV can be wrong in both directions. A summary that fits can get
  `summary_mismatch`; the person then writes the note again.
