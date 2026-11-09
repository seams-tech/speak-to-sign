# Speak-to-Sign implementation

The design is Refactor 210, Section 11.4, in `seams-monorepo/docs/refactor-210-voice-intents.md`,
as changed by Refactor 227 (`docs/refactor-227-speak-to-sign-without-passkey.md`).

## Implementation boundaries

- [`descriptor.ts`](descriptor.ts) is the application descriptor. It imports only types from
  `@seams/wallet` and loads no code.
- [`host.ts`](host.ts) is the trusted Wallet host plugin, served as `/sdk/speak-to-sign/host.js`.
  Wallet core loads it with `loadSpeakToSignHost` (`core/transactionFeatures/hostRegistry.ts`)
  and refuses a different `hostApiVersion`.
- [`host/flow.ts`](host/flow.ts) runs one spoken payment with the scoped core operations
  `captureClip`, `receiverExists`, `verify` and `payWithVerdict`
  (`core/transactionFeatures/hostOperations.ts`). The plugin gets no signing context, key or
  session. Wallet core checks the verdict (`core/transactionFeatures/voiceVerdict.ts`) and
  builds the one transfer that it signs.
- [`host/enroll.ts`](host/enroll.ts) runs one enrollment: three `captureClip` calls,
  `authorizeEnrollment` for exactly these clips (core signs one NEP-413 message), then
  `verify` with the verifier's `enroll` input. `tests/unit/speakToSignEnroll.unit.test.ts`
  checks the digest and the message against the verifier's vectors.
- `captureClip` loads the VoiceID host plugin through `loadWalletAuthMethodHostPlugin` and calls
  its `recordPhrase`, which shows the sentence and records one clip. Core returns it as a 16 kHz
  mono PCM16 WAV of at most 8 s. This package bundles no VoiceID code.
- The host bundle imports only `@seams/wallet/speak-to-sign-host`, served by the Wallet as
  `/sdk/speak-to-sign-host.js`.
- `core/transactionFeatures/spokenTransfer.ts` in `@seams/wallet` ports the account transfer
  rules of the `spoken-intent` crate. `tests/unit/speakToSignHost.unit.test.ts` checks it
  against the crate's vectors and the verifier's signed verdicts.
- [`react.ts`](react.ts) will hold the pay button and the live text component.

Speak-to-Sign is a transaction feature, not an auth method. It never unlocks a wallet or
opens a session. Wallet and Speak-to-Sign must use the same host API version, which is
separate from the VoiceID host API version.
