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
  `openPrompt`, `receiverExists`, `verify` and `payWithVerdict`
  (`core/transactionFeatures/hostOperations.ts`). The plugin gets no signing context, key or
  session. Wallet core checks the verdict (`core/transactionFeatures/voiceVerdict.ts`) and
  builds the one transfer that it signs. The signing request carries the verdict, and the Seams
  co-signer checks it again (`wallet-server/src/router/domains/speakToSign/voiceVerdictAdmission.ts`).
  `payWithVerdict` tells the open prompt when the verdict passed, when a step-up needs the
  owner, and when the transfer leaves for the network. A co-signer refusal comes back as
  `cosigner_refused`.
- [`host/enroll.ts`](host/enroll.ts) runs one enrollment: three prompts of one recording each,
  `authorizeEnrollment` for exactly these clips (core signs one NEP-413 message), then
  `verify` with the verifier's `enroll` input. The card of the third phrase stays open: it
  waits while core prepares the message (the Wallet confirm, a modal dialog, opens over it),
  shows the verifier's work, then shows the result. `tests/enroll.test.ts` checks the flow;
  seams-wallet checks core's digest and message against the verifier's vectors.
- [`host/prompt.ts`](host/prompt.ts) is the prompt lifecycle that both flows share: open the
  VoiceID prompt of one sentence, record a clip, and close the prompt when the flow is done with
  it. A prompt that cannot open or record gives `voiceid_unavailable`.
- [`host/verifier.ts`](host/verifier.ts) is the verifier wire format: the `verify` and `enroll`
  inputs, and the reader of the `enroll` output.
- [`host/result.ts`](host/result.ts) holds the results of a spoken request after its card
  opened, the map from core's payment outcome to them, the stage times of a sent request,
  `verifier_unavailable`, and the length limit of a result detail.
- [`host/card.ts`](host/card.ts) holds the copy and the line segments of each state of the card:
  the check, the payment, the step-up question, the paid result, each refusal, and the
  enrollment states.
- [`host/heardWords.ts`](host/heardWords.ts) aligns the words that the verifier heard with the
  spoken sentence, and marks each word that does not match, for the card of a `words` refusal.
- `openPrompt` loads the VoiceID host plugin through `loadWalletAuthMethodHostPlugin` and calls
  its `openPhrase`, which shows the sentence and records clips of it. The surface stays open for
  the check and the result (`packages/voiceid/src/capture/phraseCard.ts`). Core returns each
  clip as a 16 kHz mono PCM16 WAV of at most 8 s. This package bundles no VoiceID code.
- The host bundle imports only `@seams/wallet/speak-to-sign-host`, served by the Wallet as
  `/sdk/speak-to-sign-host.js`.
- `core/transactionFeatures/spokenTransfer.ts` in `@seams/wallet` ports the account transfer
  rules of the `spoken-intent` crate. The Borsh bytes and digests of the requests, the verdict
  v2 format and the pinned verifier key are in `shared-ts/src/speakToSign/`, which the Wallet
  and the co-signer share. seams-wallet `tests/unit/speakToSignHost.unit.test.ts` checks them
  against the crate's vectors and the verifier's signed verdicts. `tests/flow.test.ts` here
  checks the payment and note flows, against the fake Wallet core in `tests/fakeHost.ts`.

Speak-to-Sign is a transaction feature, not an auth method. It never unlocks a wallet or
opens a session. Wallet and Speak-to-Sign must use the same host API version, which is
separate from the VoiceID host API version.
