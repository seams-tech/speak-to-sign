# @seams/speak-to-sign

Optional spoken payments for Seams Wallet. The owner says a payment, such as
"Send 25 NEAR to alice dot testnet", and a Speak-to-Sign vault pays only after
an attested verifier checks the voice and the words.

The host plugin runs the spoken payment in the trusted Wallet host. It reads
the vault, shows the expected sentence in the VoiceID prompt, records one clip
of at most 8 s, sends it to the Seams server route `POST /speak-to-sign/v1/verify`,
checks the signed verdict against the verifier key that the vault pinned, and
asks the Wallet to send one `transfer_with_verdict` call as the owner.

The app API does not carry a receiver and an amount yet. Until it does, every
`seams.speakToSign.requestTransfer` call ends with
`{ kind: 'unavailable', reason: 'flow_not_available' }`.

Speak-to-Sign needs `@seams/voiceid` at the same version. It uses the VoiceID
enrollment, capture surface and speech assets.

## App setup

```ts
import { SeamsWeb } from '@seams/wallet';
import { speakToSign } from '@seams/speak-to-sign';

const seams = new SeamsWeb({
  // ...the rest of your configuration
  transactionFeatures: [speakToSign({ vault: 'vault.example.testnet', network: 'testnet' })],
});
await seams.speakToSign.requestTransfer({ walletId });
```

`seams.speakToSign` exists in the types only when the configuration names the
descriptor. The descriptor loads no code. An app without it never requests
`/sdk/speak-to-sign/*`.

## Wallet host setup

Compose the Wallet, VoiceID and Speak-to-Sign assets into a new directory:

```sh
npx seams-speak-to-sign-host ./wallet-host
```

The Wallet loads `/sdk/speak-to-sign/host.js` only when a spoken payment starts,
and refuses a host plugin with a different host API version.
