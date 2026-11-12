# Threat model

This page is the one list of the attackers of Speak-to-Sign: what each one
tries, what stops it, the evidence, and what is left. Other docs link here
instead of keeping their own list. The chain of proofs behind these answers
is in [`trust-chain.md`](trust-chain.md), and the live state is in
[`deployed-state.md`](deployed-state.md).

## Summary

| # | Attacker | Stopped? |
| --- | --- | --- |
| 1 | A remote attacker with a clone of the owner's voice | **Yes** |
| 2 | A changed page, a phishing site or a prompt-injected agent | **Yes** |
| 3 | A replay of an old recording or verdict | **Yes** |
| 4 | A person who holds the owner's unlocked device | Partly: a passkey above 10 NEAR |
| 5 | Malware on the owner's device that feeds audio to the browser | Partly: a passkey above 10 NEAR |
| 6 | A bot farm with text-to-speech voices | Partly: a cost for each action |
| 7 | One multisig signer who approves for another | **Yes** |
| 8 | The owner of the OutLayer project | Partly: through the Seams verify route |
| 9 | NEAR AI | Partly: the verifier source checks its TDX quotes; the live versions do not |
| 10 | The owner of the Phala app | No: trusted |
| 11 | The Seams team | No: trusted |
| 12 | A contract caller with a plain key | Key check only |
| 13 | The holder of a full-access key of a demo contract | No |

"Above 10 NEAR" means a NEAR transfer of more than 10 NEAR. A bet, a note
and a rating have no passkey step at any size.

## 1. A remote attacker with a clone of the owner's voice

**What stops it.** A cloned voice alone signs nothing.
- A verdict is not a signature. It only lets the Wallet on the owner's
  device sign that one call, and the key share of the Wallet stays on the
  device.
- Voice unlock (VoiceID) is bound to a device key. Each enrollment record
  binds the wallet, the authority, the method and the device key, an unlock
  passes a device assertion, and a new enrollment needs a fresh passkey check.
- The attacker cannot enroll its own voice on the account. A verifier
  enrollment needs a NEP-413 signature by a full-access key of the owner.

**Evidence.** Spec section 6; `packages/voiceid/src/README.md` of
[`seams-wallet` at 0.69.2](https://github.com/seams-tech/seams-wallet/blob/e9fdc65ae8ae269499dfce423412e446a87d3f0d/packages/voiceid/src/README.md).

**What is left.** Nothing, while the attacker does not have the device. See 4
and 5.

## 2. A changed page, a phishing site or a prompt-injected agent

**What stops it.** The attacker can show a different call, but the owner must
say that call aloud. The verdict binds the heard words to the digest of the
exact call. The Wallet builds the request itself from the transaction that it
signs, and it refuses a verdict for another request. In the multisig, each
other signer says the proposal from memory, not from the page.

**Evidence.** `verify_accepts_a_spoken_note_summary` (an added or dropped "not"
is refused); "a verdict for one community note does not pass for another
note" in `packages/voice-verdict/tests/verdict.test.ts`;
`an_approval_for_another_commitment_fails` in
`demo/contracts/voice-multisig/src/tests.rs`.

**What is left.** An owner who reads a harmful sentence aloud and does not
listen to it. The sentence states the exact call in plain words.

## 3. A replay of an old recording or verdict

**What stops it.** Each recording passes the verifier one time, also after a
refusal. A verdict expires 120 s after the verifier signs it. The multisig and
the market count each verdict once on chain.

**Evidence.** `verify_refuses_other_words_and_uses_the_audio`;
`the_same_verdict_twice_fails`; `VERDICT_TTL_MS` in
`crates/voice-verifier/src/config.rs`.

## 4. A person who holds the owner's unlocked device

This is the same class of risk as a forced fingerprint on a phone.

**What stops it.** A NEAR transfer above 10 NEAR gets a `step_up` verdict, and
the Wallet then asks for a passkey too.

**Evidence.** `verify_steps_up_above_ten_near`.

**What is left.** A NEAR transfer of 10 NEAR or less, a bet of any size, and
notes and ratings.

## 5. Malware on the owner's device

Malware can feed a clone or a text-to-speech voice to the browser as
microphone input, with no physical access.

**What stops it.** The same passkey step as 4. Malware cannot fake a passkey
check, because the device's secure hardware checks the user.

**What is left.** The same as 4. This build has no liveness check (fresh words
that the verifier picks at random) and no detection of synthetic speech.

## 6. A bot farm with text-to-speech voices

**What stops it.** Each action needs new audio of its exact text, and each
account needs an enrollment signed by its own full-access key. This adds a
cost to each action. It is one layer against bots, not a complete defence.

**What is left.** A text-to-speech voice can enroll and pass, and one voice can
enroll on many accounts. Future steps: synthetic-speech detection, and a check
at enrollment against the voices that are already enrolled.

## 7. One multisig signer who approves for another

**What stops it.** The verifier refuses a voice that matches a signer who
already said the proposal (`same_speaker`). The contract refuses a recording
that counted before. A signer has 3 tries for the words of a proposal.

**Evidence.** `one_voice_cannot_confirm_for_two_members` in
`crates/voice-verifier/tests/ops/multisig.rs`;
`one_recording_for_two_signers_fails` in
`demo/contracts/voice-multisig/src/tests.rs`; `MAX_TRIES` in
`crates/voice-verifier/src/ops/multisig.rs`.

## 8. The owner of the OutLayer project

The owner can add a verifier version that signs any verdict with the same key,
because the key is bound to the project, not the build. That version also gets
the audio key.

**What stops it.** The Seams verify route checks the TDX quote of each call
against the pinned WASM hash before it returns a verdict, so another build
cannot approve a signature through the Seams server (`seams-wallet` commit
`0b297e976`; see [deployed-state.md](deployed-state.md#checks-that-are-in-progress)
for its deploy).

**What is left.** A verdict from a call that skips the verify route gets the
key check only, for example a caller that does not use the Seams Wallet (see
12). A new version also gets the audio key.

## 9. NEAR AI

**What stops it.** In the verifier source on `dev` (version 0.14.0): the
verifier checks the Intel TDX quotes of NEAR AI's gateway and of its Whisper
VM, with Intel's collateral and a fresh nonce. It sends each recording to
Whisper only sealed to the key of the checked gateway, so only that TDX VM
opens it. A failed check refuses with `transcriber_not_attested`, and no
recording goes to NEAR AI. In the live versions (0.12.0 and 0.13.0): nothing.
They send the audio over TLS and do not check NEAR AI. See
[trust-chain.md](trust-chain.md#the-near-ai-check) and
[deployed-state.md](deployed-state.md).

**Evidence.** `the_recorded_report_passes`, `a_wrong_key_fails` and
`a_wrong_measurement_fails` in `crates/voice-verifier/tests/nearai_attestation.rs`;
`no_record_and_no_answer_refuses_before_any_audio_goes_to_whisper` and
`a_reply_that_the_gateway_did_not_seal_refuses_and_drops_the_record` in
`tests/ops/whisper.rs`; `tests/tdx_quote.rs` compares the worker's quote check
with `dcap-qvl`.

**What is left.** With the check: the transcript has no signature of the
model, so a false transcript from NEAR AI's VMs can pass the word check. The
verifier records the compose hash of the gateway and does not pin it, so the
code of NEAR AI's VMs is trusted. The verifier does not check the link from
the gateway to Whisper, or the NVIDIA GPU evidence. Without the check (the
live versions): also the claim that only a TEE sees the audio rests on NEAR
AI.

**The `venice` build.** A second worker (0.14.1+venice) is for a NEAR AI
Whisper outage. It sends the recording to Venice AI over TLS and checks no
TEE there, so Venice AI is trusted for the audio and for the transcript. A
caller selects it by its version key, and its verdict names the build.

## 10. The owner of the Phala app

The owner can change the speaker service and keep its key. The verifier pins
the key, not the code. Trusted.

## 11. The Seams team

The team can deploy both the verifier and the Seams server, so the quote check
of 8 does not remove this trust. Only a quote check in the device co-signer
would remove it, and that check is not planned. Trusted.

## 12. A contract caller with a plain key

A signer can call the multisig or the market from a plain NEAR key, not
through the Seams Wallet. The contract still checks the verdict and its key,
but nothing on that path checks the TDX quote. A quote check on chain costs
about 176 Tgas. See [spec 9.1](voice-intents-spec.md#91-the-verdict-key-and-the-tdx-quote).

## 13. The holder of a full-access key of a demo contract

Each of the four demo contract accounts still has a full-access key. Its
holder can deploy new code, or name another moderator of the notes contract.

## Other limits

- The verifier does not check a proof of the NEAR RPC access-key view at
  enrollment.
- The OutLayer worker of the note market
  (`demo/contracts/jev-prediction-market/resolver`) has no reproducible
  build.
- Testnet only.
