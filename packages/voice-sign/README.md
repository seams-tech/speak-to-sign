# @seams/voice-sign

Speak-to-Sign for an application with no wallet and no chain. A user
confirms an action with the voice, and your server gets a signed verdict
that it checks.

The package joins two libraries of this repository:

| Library | Job |
| --- | --- |
| `@seams/voice-capture` | Records one sentence in the browser |
| `@seams/voice-verdict` | Checks what the verifier signed |

It has three entry points:

| Import | Where | Job |
| --- | --- | --- |
| `@seams/voice-sign/browser` | The page | `recordSentence`: one sentence as the WAV of the verifier |
| `@seams/voice-sign/server` | Your server | `enroll`, `confirm`, `select`, `transcribe`, `detect`: each result is checked. `writeSummary`: the sentence that a person says for a long text |
| `@seams/voice-sign/summary` | The page | `createSummarySource`: asks for a summary early and keeps it. It needs no `@seams/voice-capture` |

Install it with the libraries that your code imports:

```bash
pnpm add @seams/voice-sign                        # a server: ./server only
pnpm add @seams/voice-sign @seams/voice-capture   # a page: ./browser needs voice-capture too
```

`@seams/voice-capture` is an optional peer dependency of the same version.
Only `./browser` imports it, so a server install has no ONNX runtime.

Seams Wallet has its own Speak-to-Sign flow, inside `@seams/wallet`. Its plugin package
`@seams/wallet-voice-sign` (up to 0.66.0 `@seams/speak-to-sign`) is no longer developed. This library needs no wallet.

A complete application is in
[`example/`](example/).

## What you need

Each developer has its own accounts. The verifier is an OutLayer worker.

1. An OutLayer payment key. It pays for each run. It also gives you your own
   storage cell (your users) and your own verdict key.
2. A NEAR AI Cloud API key, stored as the OutLayer secret `NEAR_AI_API_KEY`.
3. The version key of a verifier build with application owners: verifier
   0.10.0 or later, or 0.11.0 or later for `detect`. On testnet, the project
   `seams-v1.testnet/voice-verifier` has 0.15.0 (see `crates/voice-verifier/README.md`, "Versions").

## The browser

```ts
import { configureSpeakToSign, recordSentence } from '@seams/voice-sign/browser';

// The folder with the asset files of @seams/voice-capture (see its README).
configureSpeakToSign({ assetBase: '/voice-capture/' });

button.addEventListener('click', async () => {
  const recording = await recordSentence('Cancel my order');
  if (recording.kind === 'recorded') {
    await fetch('/api/confirm', { method: 'POST', body: JSON.stringify({ audio: recording.wavBase64 }) });
  } else {
    show(recording.message); // too little speech, or too much noise
  }
});
```

The recording ends at the pause after the speech, or after 8 s. The audio
stays in the page until you send it.

## The server

```ts
import { createSpeakToSign } from '@seams/voice-sign/server';

const speakToSign = createSpeakToSign({
  verifier: {
    baseUrl: 'https://testnet-api.outlayer.ai',
    project: 'seams-v1.testnet/voice-verifier',
    paymentKey: process.env.OUTLAYER_PAYMENT_KEY,
    versionKey: process.env.OUTLAYER_VERSION_KEY,
    secretsRef: { profile: 'main', account_id: 'you.testnet' },
  },
  verifierPublicKey: process.env.VERIFIER_PUBLIC_KEY, // from your first enroll
});

// One time for each user: three recordings of three different sentences.
await speakToSign.enroll({ owner: 'app:user-42', recordings: [wav1, wav2, wav3] });

// Did the user say the sentence of this action?
const order = { context: 'shop.example/order', summary: 'Cancel my order', payload: orderBytes };
const result = await speakToSign.confirm({ owner: 'app:user-42', action: order, recording: wav });
if (result.ok) cancelOrder();

// Or: which of these actions did the user say?
const picked = await speakToSign.select({ owner: 'app:user-42', actions: [pay, cancel], recording: wav });
if (picked.ok) run(actions[picked.index]);
```

- `owner` is `app:` and your id of the user: `a-z`, `0-9`, `.`, `_`, `-`,
  `:`. No key proves it. Your payment key is the authority for the
  enrollment, so your users trust you for their identity.
- `summary` is the sentence that the user says: 1 to 12 words of letters.
  Write a number in words ("forty dollars").
- `payload` is any bytes. The verdict binds their SHA-256 and the `context`.
  So a verdict for one order does not pass for another order.

### What `ok: true` means

The verifier's key that you pin signed a verdict, and all of these hold:

1. The verdict is for the request that this server built: the owner, the
   context, the payload and the summary.
2. The verdict is for the recording that this server sent.
3. The verdict is not expired (120 s), and this server did not accept it
   before.
4. With the `attestation` setting: the TDX quote of the call binds the
   output to a WASM hash that you accept, and the OutLayer contract approves
   the measurements of the quote.

With `ok: false`, `reason` says why: a reason of the verifier (`speaker`,
`words`, `quality`, `template_missing`, ...) or a failed check
(`bad_signature`, `request_mismatch`, `verdict_reused`, ...).

### The store of used verdicts

A verdict has no nonce. The server remembers each accepted verdict until it
expires. The default store is in the memory of one process. With several
servers, give `usedVerdicts` a shared store with an atomic `addIfAbsent`.

### `transcribe`

`transcribe` gives the words that the user said, with the speaker check. It
is weaker than `confirm`: the verifier expected no sentence, so a wrong word
of the speech-to-text model is a wrong word of the text. Do not let it
approve an action with value.

### `detect`

`detect` takes free words and a list of intents, and proposes one intent.
It needs verifier 0.11.0 or later.

```ts
const result = await speakToSign.detect({
  owner: 'app:user-42',
  intents: [
    { name: 'book_table', description: 'Book a table at a restaurant', slots: { people: 'number', time: 'text' } },
    { name: 'cancel_booking', description: 'Cancel a booking' },
  ],
  recording: wav,
});
// { ok: true, intent: 'book_table', slots: { people: 2, time: 'eight tonight' }, text: '...' }
```

The result is a proposal. A speech-to-text model and a chat model made it,
and it can be wrong. Do not let it approve an action with value: show the
proposed action, then use `confirm` or `select`. `intent: null` means that
the model named no intent of the list. The chat model is slow (about 11 s),
so set `verifier.timeoutMs` and `verifier.resourceLimits` for it.

### A server between the page and the verifier

`relayToVerifier` sends an input that your server does not read. Use it
when the page builds the input itself, for example with a recording that
the page sealed to the verifier's audio key (`sealAudio` of
`@seams/voice-verdict`, field `audio_sealed_b64`, verifier 0.12.0 and
later). Your server then carries only ciphertext for the recording; the
request fields stay in plain text. The Seams Wallet server relays the
Wallet's calls this way.

```ts
import { relayToVerifier, VerifierCallError } from '@seams/voice-sign/server';

if (input.owner !== ownerOfThisSession) throw new Error('not your voice');
const { output } = await relayToVerifier(verifier, input);
```

It gives the output unchanged, but only an output of a known kind. Other
answers throw `VerifierCallError` (`timeout`, `network`, `http` or
`output`). The output is not proof: the page or your server checks it with
`checkVerdict`. Check `owner` first. Your payment key pays for each run and
is the authority for the enrollment of each owner.

## A summary that your server writes

A person can approve a long text (a note, a message) by saying a short
summary of it. Let your server write that summary. A page that gives the
summary can put other words in the person's mouth.

```ts
import { writeSummary } from '@seams/voice-sign/server';

const written = await writeSummary({ apiKey: process.env.NEAR_AI_API_KEY }, noteText);
if (!written.ok) return refuse(written.code);
// written.summary: 1 to 12 words of letters, for example "One lane closes in March"
```

- `writeSummary` asks a chat model (default: `Qwen/Qwen3.8-27B` on NEAR AI
  Cloud, about 0.5 s). `model`, `chatUrl` and `subject` change the model,
  the service and the name of the text in the request.
- It checks the reply with `summaryRefusal` of `@seams/voice-verdict`. A
  name with a number in it keeps its letters ("COP31" becomes "COP").
  Another broken rule gets one second request.
- A failure has a fixed code: `summary_unreachable`, `summary_failed` or
  `summary_not_speakable`.
- `writeSummary(config, text, { signal })` ends the request to the model
  when `signal` aborts, for example when the caller of your route went away.
- The summary is a draft, not a checked result, unlike the results of
  `confirm` and `select`. No signature covers it. The verifier checks that
  the spoken words are the summary. Only for a community note does it also
  check that the summary gives the main point of the note. For any other
  request, the person who reads the sentence is the one check of its
  meaning, so show the text with the sentence.

The request takes time, so ask before the person presses the button.
`@seams/voice-sign/summary` keeps the summaries of a page. Its one import is
the rule check of `@seams/voice-verdict`.

```ts
import { createSummarySource } from '@seams/voice-sign/summary';

const summaries = createSummarySource({
  // Your way to reach your server. Give a code for a failure; do not throw.
  write: async (text, signal) => (await fetch('/api/summary', { method: 'POST', body: text, signal })).json(),
});

summaries.prepare(noteText); // when the text is ready: starts the request
const result = await summaries.get(noteText); // at the press: kept, in flight, or a new request
```

- The source keeps one summary for each exact text, for 5 minutes
  (`lifeMs`), and at most 8 texts (`maxEntries`). So a second try shows the
  same sentence, and a changed text gets its own summary.
- A failure is not kept: the next call asks again. A summary that breaks a
  rule of `summaryRefusal` is a failure (`summary_not_speakable`).
- A new `prepare` ends an older request that only `prepare` started and
  that no `get` waits for. So a person who edits a text leaves one request,
  not one for each pause.
- `forget()` removes the kept summaries, for example at a sign-out.

Seams Wallet uses both parts: its server route calls `writeSummary`, and
the Wallet keeps a source for `seams.near.spoken.prepare`.

## Limits

- The speech-to-text model (NEAR AI) gives its text with no signature. The
  TDX quote covers the verifier, not that model.
- English only.
- `local-speaker` builds of the verifier need `verifier.computeLimit` and a
  longer `verifier.timeoutMs`. They are at least 8 times slower, and their
  time is not stable (12 s to more than 60 s for one call on testnet).

## Tests

```sh
(cd ../voice-verdict && pnpm install && pnpm build)
(cd ../voice-capture && pnpm install && pnpm build)
pnpm install
pnpm build
pnpm test
pnpm test:browser
```

`pnpm test` runs the server side against a fake verifier that signs with a
test key. `pnpm test:browser` opens `example/` in Chromium with
a fake microphone: it enrolls a voice and confirms an action, from the
recording to the checked verdict.
