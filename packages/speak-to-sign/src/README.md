# Speak-to-Sign implementation

The design is Refactor 210, Section 11.4, in `seams-monorepo/docs/refactor-210-voice-intents.md`.

## Implementation boundaries

- [`descriptor.ts`](descriptor.ts) is the application descriptor. It imports only types from
  `@seams/wallet` and loads no code.
- [`host.ts`](host.ts) is the trusted Wallet host plugin, served as `/sdk/speak-to-sign/host.js`.
  Wallet core loads it with `loadSpeakToSignHost` (`core/transactionFeatures/hostRegistry.ts`)
  and refuses a different `hostApiVersion`.
- [`host/flow.ts`](host/flow.ts) runs one spoken payment with the scoped core operations
  `captureClip`, `viewVault`, `verify` and `submitTransfer`
  (`core/transactionFeatures/hostOperations.ts`). The plugin gets no signing context, key or
  session.
- [`host/enroll.ts`](host/enroll.ts) runs one enrollment: three `captureClip` calls,
  `authorizeEnrollment` with the digest of exactly these clips, a wait until
  `get_pending_enrollment` shows it, then `verify` with the verifier's `enroll` input.
  `tests/unit/speakToSignEnroll.unit.test.ts` checks the digest against the verifier's vector.
- `captureClip` loads the VoiceID host plugin through `loadWalletAuthMethodHostPlugin` and calls
  its `recordPhrase`, which shows the sentence and records one clip. Core returns it as a 16 kHz
  mono PCM16 WAV of at most 8 s. This package bundles no VoiceID code.
- The host bundle imports only `@seams/wallet/speak-to-sign-host`, served by the Wallet as
  `/sdk/speak-to-sign-host.js`.
- [`host/intent.ts`](host/intent.ts) ports the vault transfer rules of the `spoken-intent`
  crate. `tests/unit/speakToSignHost.unit.test.ts` checks it against the crate's vectors.
  Both flows first check the owner with `isSpeakableAccount`, the crate's `SpokenAccount` rule,
  and return `unavailable` `owner_not_speakable` before any capture, view or call: the vault
  contract creates no vault for an owner that the grammar cannot speak.
- [`host/verdict.ts`](host/verdict.ts) checks the signed verdict before the Wallet pays gas.
- [`react.ts`](react.ts) will hold the pay button and the live text component.

Speak-to-Sign is a transaction feature, not an auth method. It never unlocks a wallet or
opens a session. Wallet and Speak-to-Sign must use the same host API version, which is
separate from the VoiceID host API version.
