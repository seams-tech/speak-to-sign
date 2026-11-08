# @seams/speak-to-sign

> **Experimental. NEAR testnet only.** First released in 0.54.0.

Optional spoken payments for Seams Wallet. The owner says a payment, such as
"Send 2 NEAR to alice dot testnet". A Speak-to-Sign vault contract pays only
after an attested verifier checks the voice and the words.

One spoken payment has these steps:

1. The host plugin reads the vault: nonce, contacts and the pinned verifier key.
2. Wallet core shows the expected sentence on the VoiceID surface. It records
   one clip of at most 8 s.
3. The plugin sends the clip to the Seams server route
   `POST /speak-to-sign/v1/verify`. The server calls the pinned OutLayer
   verifier.
4. The plugin checks the signed verdict against the vault's pinned key.
5. The Wallet sends one `transfer_with_verdict` call to the vault as the owner.

## Install

Speak-to-Sign needs `@seams/voiceid` for the enrollment, the capture surface
and the speech assets. Install all three packages at the same version:

```sh
pnpm add @seams/wallet@0.55.0 @seams/voiceid@0.55.0 @seams/speak-to-sign@0.55.0
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
  transactionFeatures: [speakToSign({ vault: 'seams-wallet.testnet', network: 'testnet' })],
});

if (seams.speakToSign) {
  const result = await seams.speakToSign.requestTransfer({
    walletId,
    receiver: 'alice.testnet', // an active contact of the vault
    amount: '2', // decimal NEAR, at most two decimal places
  });
}
```

`seams.speakToSign` exists only when the configuration names the descriptor.
The descriptor is a few bytes of data and loads no code.

`requestTransfer` returns one of these results:

| `kind`        | Meaning                                                               |
| ------------- | --------------------------------------------------------------------- |
| `sent`        | The vault paid. The result has the transaction hash and stage times.  |
| `refused`     | The verifier, the local check or the vault refused. Nothing was sent. |
| `cancelled`   | The owner closed the surface.                                         |
| `unavailable` | VoiceID, the verifier or the vault could not be reached.              |

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
| `SPEAK_TO_SIGN_OUTLAYER_VERSION_KEY`        | `1e79327b0afa2a0f026aee519bd0d1801272e21cb21205d31788e4d1452231f0` |
| `SPEAK_TO_SIGN_OUTLAYER_PAYMENT_KEY`        | The OutLayer payment key. Keep it in a secret store.               |
| `SPEAK_TO_SIGN_OUTLAYER_SECRETS_PROFILE`    | `main`                                                             |
| `SPEAK_TO_SIGN_OUTLAYER_SECRETS_ACCOUNT_ID` | `cyan-loong.testnet`                                               |

The route:

- requires an active Wallet Session that can sign NEAR transactions;
- refuses a request whose `owner` is not the session's NEAR account;
- accepts a body of at most 400 KB;
- calls `<base URL>/call/<project>` with the pinned `version_key` and
  `secrets_ref`, and puts the payment key only in the `X-Payment-Key` header;
- returns the verifier output unchanged. It does not read the audio.

## Vault contract

The vault is a NEAR contract. On testnet it is `seams-wallet.testnet`, with
the verifier key `ed25519:E8E53ydtc9LRvVz9xBCRrSzyBa5nh1gK1ts53Aoo751U` pinned
at init.

| Method                  | Use                                                                                 |
| ----------------------- | ----------------------------------------------------------------------------------- |
| `transfer_with_verdict` | Pays an active contact on a verdict that the pinned key signed. The owner calls it. |
| `authorize_enrollment`  | The owner allows one enrollment of exactly these recordings, for 10 minutes.        |
| `get_vault`             | Balance, limits and the next nonce of an owner.                                     |
| `get_contacts`          | The owner's contacts and whether each one is active.                                |
| `get_verifier`          | The pinned verifier key.                                                            |

The vault rebuilds the request from its own state and the call arguments. It
checks the signature, the nonce, the contact, the limits and audio reuse.
Any failure changes no state. The host plugin reads only `get_vault`,
`get_contacts` and `get_verifier`, and sends only `transfer_with_verdict`.

## Trust model

- The vault pays only on a verdict that the pinned verifier key signed for
  this exact request: network, vault, owner, receiver, amount and nonce.
- The verifier runs in OutLayer's TEE. The OutLayer project owner can deploy a
  new version that signs with the same project-bound key.
- The speaker check runs in a Phala dstack CVM with a pinned key. The Phala app
  owner can change its code and keep that key.
- NEAR AI makes the transcript. Transcripts carry no signature, so the verifier
  trusts the NEAR AI gateway.
- Code at `walletOrigin` cannot change the amount or the receiver after the
  owner speaks: the words then do not match. The audio leaves the browser for
  OutLayer, Phala and NEAR AI.
