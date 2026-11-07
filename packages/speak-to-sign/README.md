# @seams/speak-to-sign

Optional spoken payments for Seams Wallet. The owner says a payment, such as
"Send 25 NEAR to alice dot testnet", and a Speak-to-Sign vault pays only after
an attested verifier checks the voice and the words.

This package is a skeleton. The descriptor, the Wallet host loader and the host
composition work. The spoken payment flow is not built yet: every request ends
with `{ kind: 'unavailable', reason: 'flow_not_available' }`.

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
