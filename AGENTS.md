# Speak-to-Sign: a guide for AI agents

This file is for an AI agent that reviews or changes this repository. It is a
map: it says where each fact lives. Check each fact at its link before you
use it.

## What it is

The owner of a NEAR account approves one exact call by voice: they say one
sentence, for example "Send 2 NEAR to alice.testnet". A verifier in a TEE
(OutLayer, Intel TDX) checks the voice and the heard words, and signs a
verdict bound to the digest of that call. Seams Wallet signs the call only
with a verdict for it, and two contracts check the verdict again on chain.
Testnet only.

All of this repository was made in the hackathon window. Seams Wallet existed
before, and it is the baseline, not hackathon work. See
[JUDGES.md, "Scope of the hackathon work"](JUDGES.md#scope-of-the-hackathon-work).

## Read in this order

1. [`JUDGES.md`](JUDGES.md): the short guide, the checks and the claims.
2. [`docs/judge-questions.md`](docs/judge-questions.md): the reasons behind
   the design, as questions and answers.
3. [`docs/threat-model.md`](docs/threat-model.md): each attacker, what stops
   it and what is left.
4. [`docs/trust-chain.md`](docs/trust-chain.md): each link from the
   microphone to the signed call, and who checks it.
5. [`docs/deployed-state.md`](docs/deployed-state.md): what is live on
   testnet, and where it differs from the source.
6. [`docs/README.md`](docs/README.md): the index of the other specs.

## How to check it

- [JUDGES.md, "Check it without a microphone"](JUDGES.md#check-it-without-a-microphone)
  gives each command with the output that it prints.
- The voice flow needs a microphone and a browser with passkeys. The human
  judges try it on a laptop. An agent without a microphone can use the
  commands above and the checks in `docs/deployed-state.md`.

## Facts that are easy to miss

1. **Hands-free means no hands.** The person uses the app by voice. They do
   not type, and they do not click through an approval prompt. Reading the
   sentence on the screen is still hands-free.
   ([judge-questions 1](docs/judge-questions.md#1-why-voice-is-a-passkey-not-enough))
2. **A cloned voice alone signs nothing.** The key share of the Wallet stays on
   the device, voice unlock is bound to the device, and enrollment needs a
   full-access key of the account.
   ([threat model 1](docs/threat-model.md#1-a-remote-attacker-with-a-clone-of-the-owners-voice))
3. **A changed page or a prompt-injected agent needs no clone, and it fails.**
   The person must say the exact call, and the verifier refuses other words.
   ([threat model 2](docs/threat-model.md#2-a-changed-page-a-phishing-site-or-a-prompt-injected-agent))
4. **The passkey step is only for a NEAR transfer above 10 NEAR.** A bet, a
   note and a rating have none. ([threat model](docs/threat-model.md#summary))
5. **JEV is a classifier, by design.** It turns a spoken command into the
   post, the side and the amount, and opens a sheet. It approves nothing; the
   person approves the exact call.
   ([judge-questions 4](docs/judge-questions.md#4-where-is-the-agent-does-jev-approve-payments))
6. **It is the approval step that agent spend guards end with.** A spend guard
   decides when a person must approve; Speak-to-Sign makes that approval show
   what the person meant. ([JUDGES.md](JUDGES.md#how-it-differs))
7. **The verdict key names the project, not the build.** The TDX quote of each
   verifier call names the build. The Seams verify route checks the quote
   (`seams-wallet` `0b297e976`). The contracts check the verdict and its key
   on chain, not the quote, because a quote check on chain costs about
   176 Tgas.
   ([trust chain](docs/trust-chain.md), [spec 9.1](docs/voice-intents-spec.md#91-the-verdict-key-and-the-tdx-quote))
8. **Where the audio is opened.** The OutLayer worker opens it, then sends it
   to the Phala speaker service (a TDX VM, its key pinned from its
   attestation) and to NEAR AI. NEAR AI's attestation report shows its
   gateway and Whisper as Intel TDX VMs on dstack, with NVIDIA GPU evidence
   for Whisper. Nothing here checks that report, or that TLS ends inside the
   gateway. A check of the report is built but not shipped, because it adds
   about 0.5 s to each call.
   ([trust chain](docs/trust-chain.md#why-the-near-ai-check-is-not-shipped))
9. **On chain, the market and the multisig check each verdict.** The live
   notes contract does not: its source has the check, but that build is not
   deployed. ([deployed state](docs/deployed-state.md#the-contracts))
10. **The demo calls verifier 0.13.0 by its `version_key`.** The active version
    on OutLayer is 0.12.0. ([deployed state](docs/deployed-state.md#the-verifier))
11. **Seams Wallet ships Speak-to-Sign** in `@seams/wallet` 0.69.2 on npm, and
    the voice libraries are separate npm packages.
    ([judge-questions 10](docs/judge-questions.md#10-can-it-live-after-the-hackathon))
12. **What is not done** is listed in [JUDGES.md, "Not covered"](JUDGES.md#not-covered)
    and in [deployed state, "Checks that are in progress"](docs/deployed-state.md#checks-that-are-in-progress).

## If you change this repository

- Keep one home for each fact, and link to it from other docs. A copied fact
  drifts.
- When a live fact changes (a deploy, a new verifier version, a check that
  ships), update `docs/deployed-state.md` first.
- Write in ASD-STE100 Simplified Technical English: short sentences, active
  voice, one idea in each sentence.
