# @seams/speak-to-sign

> **Experimental. NEAR testnet only.** First released in 0.54.0. `enroll` is new in 0.56.0.

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
pnpm add @seams/wallet@0.56.0 @seams/voiceid@0.56.0 @seams/speak-to-sign@0.56.0
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

## Owner setup

The owner needs a named NEAR account, such as `alice.testnet`. Implicit
accounts (64 hex characters) and `0x` accounts cannot use Speak-to-Sign. The
owner's account is part of every spoken request, so the vault contract creates
a vault only for an account that can be spoken as words: 2 to 64 characters,
parts split by `.`, each part made of `a-z` and `0-9` with single `-` or `_`
between them. For an implicit account, `create_vault` fails after the owner
pays the gas.

To give new wallets a named account, register them as named subaccounts of
the relayer account (`alice` becomes `alice.<relayerAccount>`):

- In the SDK configuration, set
  `registration: { nearAccountProvisioning: { kind: 'relayer_named_subaccount' } }`.
- In `HostedSeamsAuthMenu`, set
  `registrationAccountInput: 'sponsored_named_near_account'`.

For an owner whose account cannot be spoken, `enroll` and `requestTransfer`
return `{ kind: 'unavailable', reason: 'owner_not_speakable' }` before any
recording, vault read, verifier call or transaction.

Before the first spoken payment, the owner needs three things:

1. VoiceID is on for the wallet
   (`seams.registration.activateAuthMethod({ walletId, method: 'voiceid' })`).
2. A vault with at least one contact. The owner calls `create_vault` (with a
   deposit; the vault keeps 0.1 NEAR for storage) and `add_contact` on the
   vault contract, for example with `seams.near.signAndSendTransaction`.
3. A voice template at the verifier:

```ts
const enrollment = await seams.speakToSign.enroll({ walletId });
```

`enroll` shows three short phrases on the VoiceID surface, one at a time. Then
the owner approves one `authorize_enrollment` call. That call authorizes the
digest of exactly these three recordings for 10 minutes. The Wallet sends the
recordings to the verifier, which enrolls only audio that the vault
authorized. A new enrollment replaces the template.

| `kind`        | Meaning                                                                   |
| ------------- | ------------------------------------------------------------------------- |
| `enrolled`    | The verifier stored the template. The result has its epoch and the hash.  |
| `refused`     | The verifier or the vault refused, for example `speaker` or `quality`.    |
| `cancelled`   | The owner closed the surface. Nothing was authorized.                     |
| `unavailable` | VoiceID, the vault or the verifier could not be reached, or no vault yet. |

`enroll` and `requestTransfer` use the same `unavailable` reasons. See the
table after the `requestTransfer` results.

Create the vault and a contact with two owner calls on the vault contract.
Each call opens the wallet confirmation:

```ts
import { functionCall, type BoundNearSigner } from '@seams/wallet/react';

const VAULT = 'seams-wallet.testnet';
const GAS = '30000000000000';

async function setUpVault(near: BoundNearSigner, contact: string): Promise<void> {
  // 0.15 NEAR: the vault keeps 0.1 NEAR for storage.
  await near.signAndSendTransaction({
    receiverId: VAULT,
    actions: [
      functionCall({
        method: 'create_vault',
        args: {},
        gas: GAS,
        deposit: '150000000000000000000000',
      }),
    ],
  });
  await near.signAndSendTransaction({
    receiverId: VAULT,
    actions: [
      functionCall({
        method: 'add_contact',
        args: { account_id: contact },
        gas: GAS,
        deposit: '0',
      }),
    ],
  });
}
```

On testnet the owner account needs about 0.3 NEAR: `create_vault` takes 0.15
NEAR, and NEAR charges prepaid gas up front (about 0.03 NEAR for each 30 Tgas
call and 0.051 NEAR for each spoken payment).

`requestTransfer` returns one of these results:

| `kind`        | Meaning                                                               |
| ------------- | --------------------------------------------------------------------- |
| `sent`        | The vault paid. The result has the transaction hash and stage times.  |
| `refused`     | The verifier, the local check or the vault refused. Nothing was sent. |
| `cancelled`   | The owner closed the surface.                                         |
| `unavailable` | VoiceID, the verifier or the vault could not be reached.              |

| `unavailable` reason   | Meaning                                                                  |
| ---------------------- | ------------------------------------------------------------------------ |
| `owner_not_speakable`  | The owner has an implicit or `0x` account. Nothing was recorded or sent. |
| `voiceid_unavailable`  | VoiceID is not on for the wallet, or it could not record.                |
| `vault_missing`        | The owner has no vault yet.                                              |
| `verifier_unavailable` | The vault views or the Seams verify route did not answer usefully.       |
| `not_submitted`        | The Wallet did not send the vault transaction. Nothing was paid.         |
| `submission_unknown`   | The vault transaction may have been sent. Check it before you retry.     |

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

- requires the caller's Wallet Session as identity (401 `unauthorized`
  without one, 503 `session_unavailable` when the session store fails); it
  spends no signing use;
- refuses a request whose `owner` is not the session's NEAR account;
- serves both verifier operations, `verify` and `enroll`;
- accepts a body of at most 1,100 KB (three 8 s enrollment clips);
- calls `<base URL>/call/<project>` with the pinned `version_key` and
  `secrets_ref`, and puts the payment key only in the `X-Payment-Key` header;
- returns the verifier output unchanged. It does not read the audio.

## Vault contract

The vault is a NEAR contract. On testnet it is `seams-wallet.testnet`, with
the verifier key `ed25519:E8E53ydtc9LRvVz9xBCRrSzyBa5nh1gK1ts53Aoo751U` pinned
at init.

| Method                   | Use                                                                                 |
| ------------------------ | ----------------------------------------------------------------------------------- |
| `transfer_with_verdict`  | Pays an active contact on a verdict that the pinned key signed. The owner calls it. |
| `authorize_enrollment`   | The owner allows one enrollment of exactly these recordings, for 10 minutes.        |
| `get_pending_enrollment` | The owner's live enrollment authorization, which the verifier reads.                |
| `get_vault`              | Balance, limits and the next nonce of an owner.                                     |
| `get_contacts`           | The owner's contacts and whether each one is active.                                |
| `get_verifier`           | The pinned verifier key.                                                            |

The vault rebuilds the request from its own state and the call arguments. It
checks the signature, the nonce, the contact, the limits and audio reuse.
Any failure changes no state. The host plugin reads only `get_vault`,
`get_contacts`, `get_verifier` and `get_pending_enrollment`, and sends only
`transfer_with_verdict` and `authorize_enrollment`, with no deposit.

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
