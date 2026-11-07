# Speak-to-Sign implementation

The design is Refactor 210, Section 11.4, in `seams-monorepo/docs/refactor-210-voice-intents.md`.

## Implementation boundaries

- [`descriptor.ts`](descriptor.ts) is the application descriptor. It imports only types from
  `@seams/wallet` and loads no code.
- [`host.ts`](host.ts) is the trusted Wallet host plugin, served as `/sdk/speak-to-sign/host.js`.
  Wallet core loads it with `loadSpeakToSignHost` (`core/transactionFeatures/hostRegistry.ts`)
  and refuses a different `hostApiVersion`.
- [`react.ts`](react.ts) will hold the pay button and the live text component.

Speak-to-Sign is a transaction feature, not an auth method. It never unlocks a wallet or
opens a session. Wallet and Speak-to-Sign must use the same host API version, which is
separate from the VoiceID host API version.
