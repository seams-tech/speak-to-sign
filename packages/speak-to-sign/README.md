# @seams/speak-to-sign

> **Experimental. NEAR testnet only.** First released in 0.54.0. `enroll` is new in 0.56.0.

Optional spoken payments for Seams Wallet. The owner says a payment, such as
"Send 2 NEAR to alice dot testnet". An attested verifier checks the voice and
the words and signs a verdict. The Wallet checks the verdict and sends the
transfer from the owner's own account. The spoken sentence is the confirmation,
so an accepted payment shows no confirm and no passkey.

One spoken payment has these steps:

1. Wallet core shows the expected sentence on the VoiceID surface. It records
   one clip of at most 8 s.
2. The host plugin sends the clip and the typed transfer to the Seams server
   route `POST /speak-to-sign/v1/verify`. The server calls the pinned OutLayer
   verifier.
3. Wallet core checks the signed verdict against the verifier key that the
   Wallet pins: the transfer, the spoken text, the clip, the expiry and the
   signature.
4. On `accept`, Wallet core signs the transfer through the warm Wallet Session
   with no confirm and sends it. On `step_up`, a policy rule asked for more, and
   the owner approves again on the confirm (a passkey on a passkey session).

## Install

Speak-to-Sign needs `@seams/voiceid` for the enrollment, the capture surface
and the speech assets. Install all three packages at the same version:

```sh
pnpm add @seams/wallet@0.57.0 @seams/voiceid@0.57.0 @seams/speak-to-sign@0.57.0
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
| `cancelled`   | The owner closed the surface or the confirm.                                    |
| `unavailable` | VoiceID, the verifier or the Wallet signing path could not be reached.          |

`approval` is `voice` when the verdict alone approved the payment, and
`voice_and_passkey` when a policy rule asked for the confirm again. Today the
verifier has one stub rule: a voice payment above 10 NEAR needs a passkey. A
policy engine replaces it later.

The receiver can be any named NEAR account that the owner can say. An implicit
or `0x` account gives `receiver_not_speakable`, and an account that does not
exist gives `receiver_missing`.

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
| `SPEAK_TO_SIGN_OUTLAYER_VERSION_KEY`        | `1eef1bf32070f696b6de2c33cde8b997e73444f77b9d276af35aa2777ef7d7be` |
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
after the verifier signs it. Wallet core pays each verdict at most once, and
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
