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
   all, and the result is the last attempt's. The call returns when the card
   closes.

## Install

Speak-to-Sign needs `@seams/voiceid` for the enrollment, the capture surface
and the speech assets. Install all three packages at the same version:

```sh
pnpm add @seams/wallet@0.65.0 @seams/voiceid@0.65.0 @seams/speak-to-sign@0.65.0
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

const voice = seams.near.speakToSign;
if (voice) {
  const result = await voice.typed.transfer({
    walletId,
    receiver: 'alice.testnet', // any named NEAR account
    amount: '2', // decimal NEAR, at most two decimal places
  });
}
```

`seams.near.speakToSign` exists only when the configuration names the
descriptor. The descriptor is a few bytes of data and loads no code.

## The calls

`seams.near.speakToSign` is the NEAR signer by voice. Each signing call has the
name of the `seams.near` call that it replaces, and takes the same transaction,
delegate action or message with a `summary`:

| Normal call                   | Voice call                                | `result` of an approved call    |
| ----------------------------- | ----------------------------------------- | ------------------------------- |
| `near.signAndSendTransaction` | `near.speakToSign.signAndSendTransaction` | `{ transactionHash }`           |
| `near.signTransaction`        | `near.speakToSign.signTransaction`        | The signed transaction          |
| `near.signDelegateAction`     | `near.speakToSign.signDelegateAction`     | The signed delegate action      |
| `near.signMessage`            | `near.speakToSign.signMessage`            | The NEP-413 signature and nonce |

`seams.near.speakToSign.typed` has the calls whose sentence comes from the
request fields: `transfer`, `note`, `rating`, `mergeApproval` and `bet`.
`seams.near.speakToSign.enroll` stores the owner's voice template.

## Owner setup

Before the first spoken payment, the owner needs a voice template at the
verifier:

```ts
const enrollment = await seams.near.speakToSign.enroll({ walletId });
```

`enroll` shows three short phrases on the VoiceID surface, one at a time. If
the wallet has no VoiceID yet, the Wallet turns it on first, and the three
samples of that VoiceID enrollment are the verifier's recordings too, so the
owner reads one set for both (Wallet 0.64.0 and later, host API 9). Then the owner
approves one signed message (NEP-413) on the wallet confirm. The VoiceID card
steps aside while the confirm is open, and stays open from the last phrase to
the result. The message names the digest of exactly these three recordings. The Wallet sends
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

Every signing call returns one of these results:

| `kind`        | Meaning                                                                         |
| ------------- | ------------------------------------------------------------------------------- |
| `approved`    | The Wallet signed. The result has `result`, `approval` and the stage times.     |
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
  const posted = await seams.near.speakToSign.typed.note({
    walletId,
    contract: 'community-notes.testnet',
    postId: 7,
    text: 'The city closes one lane for two weeks. The bridge stays open.',
    summary: 'Only one lane closes for two weeks.',
  });
}

const rated = await seams.near.speakToSign.typed.rating({
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
- Both calls return the result kinds of every signing call. The refusals are the
  verifier's, `summary_not_speakable`, `note_not_valid` (the contract, the id,
  the note of 1 to 280 characters or the rating), `verdict_mismatch` and
  `transaction_failed`.
- Notes need verifier 0.4.0 or later.

## Spoken market bets

The same card can sign a bet on a prediction market that takes a NEP-141
`ft_transfer_call` with `msg`
`{"action":"bet","market_id","outcome","verdict_json","signature_b64"}`. The
owner says the amount, the outcome and the market id: "bet zero point five usdc
yes on market nine". On an approved verdict, Wallet core itself builds the call
on the token contract from the owner's account, with 1 yoctoNEAR and no confirm.
The call carries the signed verdict, so the market contract can check it too.

```ts
const bet = await seams.near.speakToSign.typed.bet({
  walletId,
  contract: 'pm-notes.testnet', // the market contract
  token: '3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af',
  marketId: 9,
  outcome: 'yes', // or 'no'
  amount: '0.5', // decimal USDC
});
```

- The token must be the USDC contract of the network (testnet: the Circle
  contract above). The sentence says "usdc" and an amount with 6 decimals, so
  another token is refused.
- The amount is a whole number of cents, from 0.01 to 1,000,000 USDC. The
  Wallet sets no other amount limit.
- The verdict binds the market contract and the token, which the owner does not
  say.
- The call returns the result kinds of every signing call. The refusals are the
  verifier's, `bet_not_valid` (the market contract, the token, the market id,
  the outcome or the amount), `verdict_mismatch` and `transaction_failed`.
- Bets need verifier 0.8.0 or later, and Wallet host API 10.

## Any transaction

`signAndSendTransaction` signs and sends any NEAR transaction by voice: any
receiver and any actions, as `near.signAndSendTransaction` takes them. It is not
tied to a contract or a method.

```ts
import { functionCall } from '@seams/wallet';

const sent = await seams.near.speakToSign.signAndSendTransaction({
  walletId,
  transaction: {
    receiverId: 'guest-book.testnet',
    actions: [functionCall({ method: 'add_message', args: { text: 'hello' } })],
  },
  summary: 'Sign the guest book.',
});
```

- The owner reads the summary aloud. It has the rules of a note summary: 1 to
  12 plain words (`summaryRefusal`).
- The verdict binds the receiver and the SHA-256 of the Borsh of the actions.
  The Seams co-signer computes that digest from the transaction that it signs,
  so one verdict approves exactly one list of actions for one receiver.
- The application writes the summary. The voice proves who approves and which
  words this person said. It does not prove that the summary describes the
  transaction. Use the typed calls (`typed.transfer`, `typed.bet` and the
  others) when one fits: their sentence comes from the request fields.
- Speak-to-Sign sets no amount limit of its own. A limit is a rule of the
  Wallet's policy engine, as for a normal signature.
- The refusals are the verifier's, `summary_not_speakable`,
  `transaction_not_valid` (the receiver, or no action), `verdict_mismatch` and
  `transaction_failed`.
- It needs verifier 0.9.0 or later, and Wallet host API 10.

### Sign only, and delegate actions

`signTransaction` takes the same request and returns the signed transaction
without sending it, as `near.signTransaction` does. `near.sendTransaction`
sends it later.

`signDelegateAction` signs a NEP-366 delegate action, as
`near.signDelegateAction` does. A relayer sends its actions for the owner.

```ts
const voice = seams.near.speakToSign;
const signed = await voice.signTransaction({ walletId, transaction, summary });
// signed.kind === 'approved': signed.result is the result of near.signTransaction

const delegated = await voice.signDelegateAction({
  walletId,
  delegate: { receiverId, actions, nonce, maxBlockHeight, publicKey },
  summary,
});
// delegated.kind === 'approved': delegated.result is the result of near.signDelegateAction
```

- The verdict binds the receiver and the actions in each of the three calls.
  One verdict signs once: as a sent transaction, a signed transaction or a
  delegate action.
- The Wallet sets the sender of a delegate action to the owner's account.

## Any NEP-413 message

`signMessage` signs a NEP-413 message by voice, as `near.signMessage` does
with a confirm.

```ts
const signed = await seams.near.speakToSign.signMessage({
  walletId,
  message: 'Log in to example.app',
  recipient: 'example.app',
  summary: 'Log in to the example app',
});
if (signed.kind === 'approved') {
  // signed.result: accountId, publicKey, signature, nonce
}
```

- The Wallet draws the 32-byte nonce before the owner speaks. The verdict binds
  the SHA-256 of the NEP-413 bytes (message, nonce, recipient, callback URL),
  which are the 32 bytes that the key signs.
- The Seams co-signer signs only bytes that start with the NEP-413 tag, so a
  message verdict never signs a transaction.
- `callbackUrl` and `state` are optional, as for `near.signMessage`. `state` is
  not signed.
- The refusals are the verifier's, `summary_not_speakable`,
  `message_not_valid` (an empty message or recipient) and `verdict_mismatch`.

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
| `SPEAK_TO_SIGN_OUTLAYER_VERSION_KEY`        | `8a0b7ba0dff61a4b45e5d1d164c011525e11fe9f4fd02a4e22368882447329ef` |
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

## Develop and release

This package lives in `packages/speak-to-sign` of
[seams-tech/speak-to-sign](https://github.com/seams-tech/speak-to-sign), beside
the verifier. It builds against the published `@seams/wallet` and
`@seams/voiceid` of the same version.

```sh
pnpm install
pnpm type-check
pnpm test
pnpm build
```

The tests run the host plugin in Node against a fake Wallet core. The Wallet
side of Speak-to-Sign (the request bytes, the verdict check and the co-signer
check) is tested in seams-tech/seams-wallet.

A release has these steps:

1. Release `@seams/wallet` and `@seams/voiceid` from seams-tech/seams-wallet.
2. Set the same version here: `version`, and the `@seams/wallet` and
   `@seams/voiceid` entries of `peerDependencies` and `devDependencies`. Run
   `pnpm install` and commit `pnpm-lock.yaml`.
3. Run the "Release @seams/speak-to-sign" workflow with that version.

Before the Wallet packages of a new version are on npm, build against a local
seams-wallet checkout with `pnpm link <path to packages/wallet>` and
`pnpm link <path to packages/voiceid>`.
