# @seams/speak-to-sign

Speak-to-Sign for an application with no wallet and no chain. A user
confirms an action with the voice, and your server gets a signed verdict
that it checks.

The package joins two libraries of this repository:

| Library | Job |
| --- | --- |
| `@seams/voice-capture` | Records one sentence in the browser |
| `@seams/voice-verdict` | Checks what the verifier signed |

It has two entry points:

| Import | Where | Job |
| --- | --- | --- |
| `@seams/speak-to-sign/browser` | The page | `recordSentence`: one sentence as the WAV of the verifier |
| `@seams/speak-to-sign/server` | Your server | `enroll`, `confirm`, `select`, `transcribe`, `detect`: each result is checked |

Until version 0.65.0, the npm name `@seams/speak-to-sign` was the host
plugin for Seams Wallet. The plugin is now `@seams/speak-to-sign-wallet`
(`packages/speak-to-sign-wallet`). This library is not on npm yet.

A complete application is in
[`examples/voice-confirm`](../../examples/voice-confirm).

## What you need

Each developer has its own accounts. The verifier is an OutLayer worker.

1. An OutLayer payment key. It pays for each run. It also gives you your own
   storage cell (your users) and your own verdict key.
2. A NEAR AI Cloud API key, stored as the OutLayer secret `NEAR_AI_API_KEY`.
3. The version key of a verifier build with application owners: verifier
   0.10.0 or later, or 0.11.0 or later for `detect` (see `crates/voice-verifier/README.md`, "Versions").

## The browser

```ts
import { configureSpeakToSign, recordSentence } from '@seams/speak-to-sign/browser';

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
import { createSpeakToSign } from '@seams/speak-to-sign/server';

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

## Limits

- The voice proves that the enrolled person said the sentence. It does not
  prove that the voice was live: a good voice clone can pass.
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
pnpm test
```

The server tests use a fake verifier that signs with a test key. The
browser entry point has no test here: `@seams/voice-capture` tests the
recording.
