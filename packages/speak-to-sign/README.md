# @seams/speak-to-sign

Optional spoken payments for Seams Wallet. The owner says a payment, such as
"Send 25 NEAR to alice dot testnet", and a Speak-to-Sign vault pays only after
an attested verifier checks the voice and the words.

The host plugin runs the spoken payment in the trusted Wallet host. It reads
the vault and asks Wallet core to record the expected sentence. Core shows the
sentence on the VoiceID surface and returns one clip of at most 8 s. The plugin
sends the clip to the Seams server route `POST /speak-to-sign/v1/verify`, checks
the signed verdict against the verifier key that the vault pinned, and asks the
Wallet to send one `transfer_with_verdict` call as the owner.

## Install

Speak-to-Sign is an optional package, like `@seams/voiceid`. It needs VoiceID
for the enrollment, the capture surface and the speech assets. Install all
three packages at the same version:

```sh
pnpm add @seams/wallet@0.53.0 @seams/voiceid@0.53.0 @seams/speak-to-sign@0.53.0
```

An app that does not install `@seams/speak-to-sign` downloads none of its code.
`@seams/wallet` does not depend on it.

## App setup

Add the descriptor to `transactionFeatures`:

```ts
import { SeamsWeb } from '@seams/wallet';
import { voiceIdAuthMethod } from '@seams/voiceid';
import { speakToSign } from '@seams/speak-to-sign';

const seams = new SeamsWeb({
  // ...the rest of your configuration
  authMethods: [voiceIdAuthMethod()],
  transactionFeatures: [speakToSign({ vault: 'vault.example.testnet', network: 'testnet' })],
});
if (seams.speakToSign) {
  const result = await seams.speakToSign.requestTransfer({
    walletId,
    receiver: 'alice.testnet',
    amount: '25',
  });
}
```

`seams.speakToSign` exists only when the configuration names the descriptor.
The descriptor loads no code. An app without it never requests
`/sdk/speak-to-sign/*`.

## Wallet host setup

Compose the Wallet, VoiceID and Speak-to-Sign assets into a new directory:

```sh
npx --no-install seams-speak-to-sign-host <dir>
```

The Wallet loads `/sdk/speak-to-sign/host.js` only when a spoken payment starts,
and refuses a host plugin with a different host API version. The host plugin
imports only `/sdk/speak-to-sign-host.js` from the Wallet. It bundles no VoiceID
code: the VoiceID host plugin records the clip for Wallet core.
