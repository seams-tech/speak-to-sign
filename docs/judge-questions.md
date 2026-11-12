# Questions a judge asks

These are the questions that a strict review of Speak-to-Sign asked, with the
answers and the evidence. Each answer gives the short answer first, then where
to check it, then what is not done. [`JUDGES.md`](../JUDGES.md) is the guide;
this page gives the reasons behind the design.

- [1. Why voice? Is a passkey not enough?](#1-why-voice-is-a-passkey-not-enough)
- [2. Voice can be cloned. Why trust it?](#2-voice-can-be-cloned-why-trust-it)
- [3. What if the page or the agent is compromised?](#3-what-if-the-page-or-the-agent-is-compromised)
- [4. Where is the agent? Does JEV approve payments?](#4-where-is-the-agent-does-jev-approve-payments)
- [5. How is this different from the agent spend guards?](#5-how-is-this-different-from-the-agent-spend-guards)
- [6. What is new here?](#6-what-is-new-here)
- [7. Who controls the verifier?](#7-who-controls-the-verifier)
- [8. What is the hard part?](#8-what-is-the-hard-part)
- [9. Can a judge try it?](#9-can-a-judge-try-it)
- [10. Can it live after the hackathon?](#10-can-it-live-after-the-hackathon)

## 1. Why voice? Is a passkey not enough?

**Short answer.** People now give AI agents spoken commands, and more and more
of them talk to AI by voice. When an agent must spend money, the person must
approve the exact call. Today that approval is a prompt with a button. In a
voice session, a button breaks the flow. Many prompts in a row also cause
approval fatigue: people press "approve" and do not read. Push-approval fatigue
is a known attack on login prompts for the same reason.

A passkey tap shows that a device approved something. It does not show what
the person agreed to. In Speak-to-Sign, the person says the exact call ("Send
2 NEAR to alice.testnet"), so the approval shows what they meant. The verifier
checks that the heard words are the words of that call.

The passkey stays for large NEAR transfers. For a NEAR transfer above 10
NEAR, the verifier answers `step_up`, and the Wallet asks for a passkey too.
A bet or another call has no such step yet (`policy::decide` in
`crates/voice-verifier/src/policy.rs`).

**Check it.** `verify_steps_up_above_ten_near` in
`crates/voice-verifier/tests/ops/verify.rs`; spec 7.3.

**Hands-free today.** The person uses the app by voice: the voice bar takes
the command, and the spoken sentence approves the call. The person does not
type, and does not click through an approval prompt.

**Not done.** A mode with no screen, in which the page says the call aloud
for the person to repeat, is not built.

## 2. Voice can be cloned. Why trust it?

**Short answer.** A cloned voice alone gets an attacker nothing. The attack
also needs the person's own device, with the Wallet unlocked. An attacker
with both can do much more harm than a voice clone.

1. **The keys stay on the device.** The Wallet runs in an isolated iframe on
   its own origin, and its key share stays on the device. A verdict is not a
   signature: it only lets the Wallet on that device sign that one call.
   Voice unlock (VoiceID) is bound to a device key. Each enrollment record
   binds the wallet, the authority, the method and the device key, and an
   unlock passes a device assertion. A new enrollment needs a fresh passkey
   check. So on another device, a cloned voice cannot unlock the Wallet.
2. **The common attack needs no clone.** A changed page or a prompt-injected
   agent asks for a call that the person did not mean. The person must say
   that call aloud, so they hear it, and the verifier refuses other words.
   See question 3.
3. **The rest of the risk has a limit.** A clone works only on the person's
   own device, with the Wallet unlocked. That needs the device in hand, like
   a forced fingerprint on a phone, or malware that controls it. Such an
   attacker can already do much more harm than a voice clone. Even then, a
   NEAR transfer above 10 NEAR needs a passkey, and malware cannot fake a
   passkey check. Each recording passes one time only.

**Check it.**
- `verify_steps_up_above_ten_near` and
  `verify_refuses_other_words_and_uses_the_audio` in
  `crates/voice-verifier/tests/ops/verify.rs`.
- The device binding of VoiceID: `packages/voiceid/src/README.md` of
  [`seams-wallet` at 0.69.2](https://github.com/seams-tech/seams-wallet/blob/e9fdc65ae8ae269499dfce423412e446a87d3f0d/packages/voiceid/src/README.md).

**Not done.** On the person's own device, with the Wallet unlocked and in an
attacker's hands (or under malware), a good clone can pass for a NEAR
transfer of 10 NEAR or less, for a bet of any size, and for the other calls.
This build has no liveness check (fresh words) and no detection of synthetic
speech. See [Not covered](../JUDGES.md#not-covered) and
[Future improvements](../JUDGES.md#future-improvements).

## 3. What if the page or the agent is compromised?

**Short answer.** The verdict binds the heard words to the digest of the
exact call. A changed page or an injected agent can show a different call,
but the person then says that different call aloud and hears it. If the words
do not match the call that is signed, the verifier refuses. A verdict for one
call does not pass for another call.

In February 2025, attackers took about US$1.5 billion from Bybit. They changed
the Safe{Wallet} page, and the signers approved a transaction that they did
not see. In the voice multisig, each other signer says the proposal from
memory, not from the page. So a changed page cannot put other words in the
signer's mouth.

**Check it.**
- `verify_accepts_a_spoken_note_summary` in
  `crates/voice-verifier/tests/ops/notes.rs`: an added or dropped "not" is
  refused.
- "a verdict for one community note does not pass for another note" in
  `packages/voice-verdict/tests/verdict.test.ts`.
- `an_approval_for_another_commitment_fails` and
  `one_recording_for_two_signers_fails` in
  `demo/contracts/voice-multisig/src/tests.rs`.

**Not done.** No multisig proposal has run on testnet yet, and the demo site
has no page for the multisig.

## 4. Where is the agent? Does JEV approve payments?

**Short answer.** No, by design. AI does the work around the approval, and the
person makes the decision:

- **NEAR AI drafts the note** for each post, and the person can change it.
- **JEV classifies the spoken command.** In the voice bar, the person says
  what to do ("bet one dollar on no on the second note"). JEV turns the words
  into a command (the post, the side and the amount) and opens the bet sheet.
  It signs nothing and approves nothing.
- **The person approves the exact call by voice.** An agent can prepare a
  call, but it cannot complete the call without a verdict for that exact
  call.

**Check it.** The classifier is `demo/frontend/functions/lib/jevCommand.ts`.
The market contract checks the verdict of each bet before it takes the USDC
(`check_spoken_bet` in `demo/contracts/jev-prediction-market/src/lib.rs`), and
`get_voice_config` on `pm-notes.seams-v1.testnet` returns `required: true`.

**Not done.** No policy lets an agent spend a small amount without a spoken
approval.

## 5. How is this different from the agent spend guards?

**Short answer.** Spend guards limit what an agent can do: caps, allowlists,
policy contracts or an AI judge. A large payment then waits for a person's
tap. Speak-to-Sign is that human step: the approval itself is the spoken
exact call. The two work together. A spend guard decides when a person must
approve, and Speak-to-Sign makes that approval show what the person meant.

Other voice confirmations accept a spoken "yes". A "yes" binds to nothing:
nothing checks who spoke, and nothing ties the words to the call.

## 6. What is new here?

**Short answer.** The parts exist one by one: smart speakers can buy by voice
with a voice profile, phone banks use voice ID, and hardware wallets show the
transaction before you sign. What is new is the binding. The heard words are
bound to the cryptographic digest of the exact call. An attested verifier
checks the voice and the words. The Wallet checks the verdict before it signs,
and the market and multisig contracts check it again on chain, so no other
path can approve a bet or a multisig approval. The deployed notes contract
does not check the verdict yet: its voice rule (commit `119ef0e`) is not
deployed.

## 7. Who controls the verifier?

**Short answer.** Today the Wallet and the contracts pin the verdict key of
the verifier. The active verifier is a reproducible build of this repo: check
3 of [`JUDGES.md`](../JUDGES.md#check-it-without-a-microphone) builds it in
Docker and reads the same SHA-256 on OutLayer. The demo calls verifier 0.13.0
through the Seams staging server, and check 3 builds that version too. The
speaker key of the Phala service comes from its TDX attestation (`SPEAKER_PINNED_KEY_HEX` in
`crates/voice-verifier/src/config.rs`).

**Why the server checks the quote, not the contracts.** Checking the TDX quote
off chain before the Seams co-signer signs keeps the same Intel TDX root of
trust with zero quote gas or chain bloat. On chain, `pm-notes` and
`voice-multisig` check the ed25519 verdict signature instead. See
[spec 9.1](voice-intents-spec.md#91-the-verdict-key-and-the-tdx-quote).

**Not done.** The owner of the OutLayer project can deploy new code that signs
with the same key, because the verdict key names the project, not the build.
Each verifier call returns a TDX quote that names its WASM. The Seams verify
route checks that quote against the pinned WASM hash before it returns a
verdict, so that trust rests on the build and not on the key (`seams-wallet`
commit `0b297e976`). A verdict from a call that skips the route gets the key
check only ([`trust-chain.md`](trust-chain.md)).

## 8. What is the hard part?

The code size and the number of tests are not the point. These design
problems are:

- **The words rule.** A spoken summary may have one changed or dropped word,
  but an added or dropped "not" is refused (spec 7.2,
  `crates/voice-verifier/src/words.rs`).
- **One chain of trust across two TEEs.** The OutLayer verifier pins the key of
  the Phala speaker service from its TDX attestation (spec 7.1).
- **Sealed audio.** The device seals each recording to the verifier's audio
  key before it leaves the device, so the Seams server and OutLayer carry only
  ciphertext (spec 5.1).
- **Replay protection.** Each recording passes one time, also after a refusal
  (spec 5).
- **Checks on chain.** The market and the multisig check each verdict
  themselves: the key, the expiry, the owner and the digest.
- **Builds that anyone can repeat.** The verifier and the four demo contracts
  are reproducible builds, and SourceScan verified the contracts.

## 9. Can a judge try it?

**Short answer.** Yes. You need a laptop with a microphone and a browser with
passkeys. The setup has three steps on the page: create a wallet (a passkey),
record three short clips, and press the faucet, which sends 0.2 NEAR and 2
testnet USDC to the new account. Then follow
[See it in 2 minutes](../JUDGES.md#see-it-in-2-minutes).

A verdict usually takes about 2 s. On 2026-11-11, the OutLayer delay went
above 90 s.

## 10. Can it live after the hackathon?

**Short answer.** Speak-to-Sign is a feature of a wallet that existed before
the hackathon. Seams Wallet ships it in `@seams/wallet` 0.69.2 on npm as an
experimental, testnet-only feature. The voice libraries are separate npm
packages for any app: `@seams/voice-capture`, `@seams/voice-verdict` and
`@seams/voice-sign`.

It runs on the NEAR stack: NEAR AI Cloud for the transcript and the note
drafts, OutLayer for the TEE, and NEAR contracts for the checks on chain.

**Voice data.** The verifier keeps no recording. It keeps one template of 192
numbers for each owner, encrypted by the OutLayer keystore, and the hash of
each used recording. The device seals each recording before it leaves the
device. See [`docs/architecture.md`](architecture.md), "What is kept after a
run".

**Not done.** Testnet only. The verifier sends the opened recording to the
Phala speaker service, whose key it pins from its attestation, and to NEAR
AI. The live verifier versions do not check NEAR AI's attestation. The
verifier source (0.14.0) checks the TDX quotes of NEAR AI's gateway and of
Whisper, and sends the recording only sealed to the checked gateway; that
build is not live yet (see
[`trust-chain.md`](trust-chain.md#the-near-ai-check)). There is no mainnet
date yet.
