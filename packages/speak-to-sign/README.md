# @seams/speak-to-sign

> **Experimental. NEAR testnet only.** First released in 0.54.0. `enroll` is new in 0.56.0.

Optional spoken payments for Seams Wallet. The owner says a payment, such as
"Send 2 NEAR to alice dot testnet". An attested verifier checks the voice and
the words and signs a verdict. The Wallet checks the verdict and sends the
transfer from the owner's own account. The spoken sentence is the confirmation,
so an accepted payment shows no confirm and no passkey.

One spoken payment has these steps:

1. Wallet core shows the expected sentence on the VoiceID surface. It records
   one clip of at most 8 s. The surface stays open: it shows the check, the
   payment and the result in the same card.
2. The host plugin sends the clip and the typed transfer to the Seams server
   route `POST /speak-to-sign/v1/verify`. The server calls the pinned OutLayer
   verifier.
3. Wallet core checks the signed verdict against the verifier key that the
   Wallet pins: the transfer, the spoken text, the clip, the expiry and the
   signature.
4. On `accept`, Wallet core signs the transfer through the warm Wallet Session
   with no confirm and sends it. On `step_up`, a policy rule asked for more: the
   card asks the owner to confirm, and the Wallet asks for a fresh approval with
   the session's own method (a passkey on a passkey session).
5. The card shows the result. "Done" closes it after a payment. After a
   refusal, "Try again" records the sentence again, up to five recordings in
   all, and the result is the last attempt's. `requestTransfer` returns when
   the card closes.

## Install

Speak-to-Sign needs `@seams/voiceid` for the enrollment, the capture surface
and the speech assets. Install all three packages at the same version:

```sh
pnpm add @seams/wallet@0.58.1 @seams/voiceid@0.58.1 @seams/speak-to-sign@0.58.1
```

`@seams/wallet` does not depend on this package. An app without the
descriptor downloads none of its code, WASM or assets, and never requests
`/sdk/speak-to-sign/*`.

## App setup

Add the descriptor to `transactionFeatures`:

```ts
import { SeamsWeb } from '@seams/wallet';
import { voiceIdAuthMethod } from '@seams/voiceid';
import { speakToSign } from '@seams/speak-to-sign';

const seams = new SeamsWeb({
  // ...the rest of your configuration
  authMethods: [voiceIdAuthMethod()],
  transactionFeatures: [speakToSign({ network: 'testnet' })],
});

if (seams.speakToSign) {
  const result = await seams.speakToSign.requestTransfer({
    walletId,
    receiver: 'alice.testnet', // any named NEAR account
    amount: '2', // decimal NEAR, at most two decimal places
  });
}
```

`seams.speakToSign` exists only when the configuration names the descriptor.
The descriptor is a few bytes of data and loads no code.

## Owner setup

Before the first spoken payment, the owner needs two things:

1. VoiceID is on for the wallet
   (`seams.registration.activateAuthMethod({ walletId, method: 'voiceid' })`).
2. A voice template at the verifier:

```ts
const enrollment = await seams.speakToSign.enroll({ walletId });
```

`enroll` shows three short phrases on the VoiceID surface, one at a time. Then
the owner approves one signed message (NEP-413) on the wallet confirm. The
message names the digest of exactly these three recordings. The Wallet sends
the recordings and the signature to the verifier. The verifier checks that a
full-access key of the owner signed the message, and stores the template. A new
enrollment replaces the template.

| `kind`        | Meaning                                                             |
| ------------- | ------------------------------------------------------------------- |
| `enrolled`    | The verifier stored the template. The result has its epoch.         |
| `refused`     | The verifier refused, for example `speaker`, `quality` or `not_authorized`. |
| `cancelled`   | The owner closed the surface. Nothing was signed.                   |
| `unavailable` | VoiceID or the verifier could not be reached, or the message was not signed. |

A spoken payment needs a warm Wallet Session. If the session is locked or
expired, the Wallet asks the owner to unlock first. The owner's account pays the
gas of each transfer, about 0.00005 NEAR.

`requestTransfer` returns one of these results:

| `kind`        | Meaning                                                                         |
| ------------- | ------------------------------------------------------------------------------- |
| `sent`        | The transfer was paid. The result has the hash, `approval` and the stage times. |
| `refused`     | The verifier, the verdict check or the chain refused, for example `words`.      |
| `cancelled`   | The owner closed the surface before a verdict, or closed the step-up question.  |
| `unavailable` | VoiceID, the verifier or the Wallet signing path could not be reached.          |

`approval` is `voice` when the verdict alone approved the payment, and
`voice_and_passkey` when a policy rule asked for the confirm again. Today the
verifier has one stub rule: a voice payment above 10 NEAR needs a passkey. A
policy engine replaces it later.

The receiver can be any named NEAR account that the owner can say. An implicit
or `0x` account gives `receiver_not_speakable`, and an account that does not
exist gives `receiver_missing`.

## Spoken community notes

The same card can sign a community note or a note rating, on a notes contract
that has `add_note({ post_id, text, summary })` and
`rate_note({ note_id, rating })`. The author types the note and reads aloud only
a short summary. The verdict binds the full note by its SHA-256. On an approved
verdict, Wallet core itself builds one call from the owner's account, with no
deposit and no confirm.

```ts
import { summaryRefusal } from '@seams/wallet';

// null when the summary is 1 to 12 plain words of ASCII letters.
if (summaryRefusal(summary) === null) {
  const posted = await seams.speakToSign.requestNote({
    walletId,
    contract: 'community-notes.testnet',
    postId: 7,
    text: 'The city closes one lane for two weeks. The bridge stays open.',
    summary: 'Only one lane closes for two weeks.',
  });
}

const rated = await seams.speakToSign.requestRating({
  walletId,
  contract: 'community-notes.testnet',
  noteId: 3,
  rating: 'helpful', // or 'somewhat_helpful', 'not_helpful'
});
```

- A summary has 1 to 12 words of ASCII letters, with one space between two
  words. A word can end with a comma, and the summary can end with `.`, `!` or
  `?`. Digits, apostrophes, hyphens, URLs and handles are refused
  (`summary_not_speakable`), because a speech-to-text model can write them in
  another way. Write numbers as words.
- A rating is said as "this note is helpful", "this note is somewhat helpful"
  or "this note is not helpful".
- The words must match. A summary of 4 or more words also passes with one word
  heard differently or dropped, but never with an added or dropped "not".
- Both calls return the result kinds of `requestTransfer`. The refusals are the
  verifier's, `summary_not_speakable`, `note_not_valid` (the contract, the id,
  the note of 1 to 280 characters or the rating), `verdict_mismatch` and
  `transaction_failed`.
- Notes need verifier 0.4.0 or later.

## Wallet host setup

The operator of `walletOrigin` installs the same three packages. Then the
operator composes the Wallet, VoiceID and Speak-to-Sign assets into a new
directory:

```sh
npx --no-install seams-speak-to-sign-host <dir>
```

Deploy that directory as the static root of `walletOrigin`. The Wallet loads
`/sdk/speak-to-sign/host.js` only when a spoken payment starts. It refuses a
host plugin with a different host API version. The host plugin bundles no
VoiceID code: the VoiceID host plugin records the clip.

## Seams server route

`@seams/wallet-server` adds `POST /speak-to-sign/v1/verify` only when all six
variables are set. A partial set is a deployment error.

| Variable                                    | Testnet value                                                      |
| ------------------------------------------- | ------------------------------------------------------------------ |
| `SPEAK_TO_SIGN_OUTLAYER_BASE_URL`           | `https://testnet-api.outlayer.ai`                                  |
| `SPEAK_TO_SIGN_OUTLAYER_PROJECT`            | `seams-v1.testnet/voice-verifier`                                  |
| `SPEAK_TO_SIGN_OUTLAYER_VERSION_KEY`        | `5b6fad5df11440847e13508f57736da8de371526824cf12178dfc20be2c9c1d1` |
| `SPEAK_TO_SIGN_OUTLAYER_PAYMENT_KEY`        | The OutLayer payment key. Keep it in a secret store.               |
| `SPEAK_TO_SIGN_OUTLAYER_SECRETS_PROFILE`    | `main`                                                             |
| `SPEAK_TO_SIGN_OUTLAYER_SECRETS_ACCOUNT_ID` | `cyan-loong.testnet`                                               |

The route:

- requires the caller's Wallet Session as identity (401 `unauthorized`
  without one, 503 `session_unavailable` when the session store fails); it
  spends no signing use;
- refuses a request whose `owner` is not the session's NEAR account;
- serves both verifier operations, `verify` and `enroll`;
- accepts a body of at most 1,100 KB (three 8 s enrollment clips);
- calls `<base URL>/call/<project>` with the pinned `version_key` and
  `secrets_ref`, and puts the payment key only in the `X-Payment-Key` header;
- returns the verifier output unchanged. It does not read the audio.

## Verifier

The verifier is the OutLayer project `seams-v1.testnet/voice-verifier`. Its
verdict key `ed25519:E8E53ydtc9LRvVz9xBCRrSzyBa5nh1gK1ts53Aoo751U` is bound to
the project and stays the same across versions. The Wallet pins that key in its
own code for testnet. It never takes the key from the app, because the app
chooses the Seams server URL.

A verdict (`seams_voice_signed_verdict_v2`) binds the network, the owner, the
receiver, the amount, the spoken text and the audio digest. It expires 120 s
after the verifier signs it. Wallet core pays at most once in each flow, and
only for a clip that it recorded in the same flow. The verifier marks each
recording used.

## Trust model

- Wallet core signs only after a verdict that the pinned verifier key signed for
  this exact request: network, owner, receiver and amount, and a clip of this
  flow. The Wallet Session and the Seams co-signer still take part in every
  signature, so the voice adds an approval and removes none of the session's
  checks.
- There is no on-chain limit for a spoken payment. A payment above the policy
  rule's amount needs the confirm again.
- The verifier runs in OutLayer's TEE. The OutLayer project owner can deploy a
  new version that signs with the same project-bound key.
- The speaker check runs in a Phala dstack CVM with a pinned key. The Phala app
  owner can change its code and keep that key.
- NEAR AI makes the transcript. Transcripts carry no signature, so the verifier
  trusts the NEAR AI gateway.
- Code at `walletOrigin` cannot change the amount or the receiver after the
  owner speaks: the words then do not match. The audio leaves the browser for
  OutLayer, Phala and NEAR AI.
- Any named account can receive. If the voice check accepts a clone or a
  replay of the owner's voice, the payment can go to any named account. The
  step-up rule asks for the confirm above 10 NEAR; below it, the voice alone
  pays.
- The verifier cannot tell apart two accounts that sound the same, such as
  `bob.testnet` and `bobb.testnet`. The owner must read the account on the
  screen before speaking.
