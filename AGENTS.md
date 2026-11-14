# Speak-to-Sign: a guide for AI agents

This file is for an AI agent that reviews or changes this repository. It is a
map: it says where each fact lives. Check each fact at its link before you
use it.

## What it is

The owner of a NEAR account approves one exact call by voice: they say one
sentence, for example "Send 2 NEAR to alice.testnet". A verifier in a TEE
(OutLayer, Intel TDX) checks the voice and the heard words, and signs a
verdict bound to the digest of that call. Seams Wallet signs the call only
with a verdict for it, and three contracts check the verdict again on chain.
Testnet only.

All of this repository was made in the hackathon window. Seams Wallet existed
before, and it is the baseline, not hackathon work. See
[JUDGES.md, "Scope of the hackathon work"](JUDGES.md#scope-of-the-hackathon-work).

## Read in this order

1. [`JUDGES.md`](JUDGES.md): the short guide, the questions of a strict
   review, the checks and the claims.
2. [`docs/threat-model.md`](docs/threat-model.md): each attacker, what stops
   it and what is left.
3. [`docs/trust-chain.md`](docs/trust-chain.md): each link from the
   microphone to the signed call, and who checks it.
4. [`docs/deployed-state.md`](docs/deployed-state.md): what is live on
   testnet, and where it differs from the source.
5. [`docs/README.md`](docs/README.md): the index of the other specs.

The folder tree is in [README.md, "Repository"](README.md#repository). The
README next to each part gives its details: the verifier, each library, each
contract and the demo site.

## How to check it

- [JUDGES.md, "Check it from a terminal"](JUDGES.md#check-it-from-a-terminal)
  gives each command with the output that it prints.
- The voice flow needs a microphone and a browser with passkeys. The human
  judges try it on a laptop. An agent without a microphone can use the
  commands above and the checks in `docs/deployed-state.md`.

## Facts that are easy to miss

1. **Hands-free means no hands.** The person uses the app by voice. They do
   not type, and they do not click through an approval prompt. Reading the
   sentence on the screen is still hands-free.
   ([JUDGES.md, use case 1](JUDGES.md#1-voice-agent-payments-and-hands-free-finance-the-spoken-sentence-is-the-approval))
2. **A cloned voice alone signs nothing.** The key share of the Wallet stays on
   the device, voice unlock is bound to the device, and enrollment needs a
   full-access key of the account.
   ([threat model 1](docs/threat-model.md#1-a-remote-attacker-with-a-clone-of-the-owners-voice))
3. **A changed page or a prompt-injected agent needs no clone, and it fails.**
   The person must say the exact call, and the verifier refuses other words.
   ([threat model 2](docs/threat-model.md#2-a-changed-page-a-phishing-site-or-a-prompt-injected-agent))
4. **No action has a passkey step after the voice.** The verifier has no
   policy rule: it signs `accept` or `refuse`, and no `step_up`. The verdict
   format keeps `step_up` for a later rule.
   ([spec 7.3](docs/voice-intents-spec.md#73-no-policy-step),
   [threat model](docs/threat-model.md#summary))
5. **JEV is a classifier, by design.** It turns a spoken command into the
   post, the side and the amount, and opens a sheet. It approves nothing; the
   person approves the exact call.
   ([JUDGES.md, "Questions a judge asks"](JUDGES.md#questions-a-judge-asks))
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
   attestation) and to Whisper. Verifier 0.15.0, the active version, checks
   the Intel TDX quotes of NEAR AI's gateway and of Whisper inside the worker,
   and sends the audio to Whisper only sealed to the checked gateway. One
   path has no such check: the `venice` build, which the Seams staging server
   and the demo route select while NEAR AI Whisper is down (Venice AI has no
   TEE).
   ([trust chain](docs/trust-chain.md#the-near-ai-check),
   [deployed state](docs/deployed-state.md#the-verifier))
9. **On chain, the notes contract, the market and the multisig check each
   verdict.** Each contract checks the ed25519 verdict signature and refuses a
   used verdict, so a bot with a plain NEAR key outside Seams Wallet cannot
   skip the voice rule over RPC. The Wallet guards actions that have no
   receiver contract code, such as native NEAR transfers
   (`demo/speak-to-pay`). A verdict that passes holds no transcript, so the
   spoken words do not go on chain; only a `words` refusal has the heard
   words.
   ([deployed state](docs/deployed-state.md#the-contracts),
   [spec 9](docs/voice-intents-spec.md#9-who-checks-the-verdict),
   [spec 8.2](docs/voice-intents-spec.md#82-the-heard-words))
10. **The active verifier is 0.15.0.** The Seams staging server (a transfer, a
    note, a rating, a bet) and the demo route of the multisig page call it.
    Both call 0.15.0+venice while NEAR AI Whisper is down.
    ([deployed state](docs/deployed-state.md#the-verifier))
11. **Seams Wallet ships Speak-to-Sign** in `@seams/wallet` 0.71.0 on npm, and
    the voice libraries are separate npm packages.
    ([JUDGES.md, "Questions a judge asks"](JUDGES.md#questions-a-judge-asks))
12. **What is not done.** [JUDGES.md, "Not covered"](JUDGES.md#not-covered)
    is the short list. The full list of the trusted parties is in
    [trust chain, "Who is trusted, not verified"](docs/trust-chain.md#who-is-trusted-not-verified),
    and the threat model says what is left for each attacker.

## If you change this repository

- Keep one home for each fact, and link to it from other docs. A copied fact
  drifts.
- When a live fact changes (a deploy, a new verifier version, a check that
  ships), update `docs/deployed-state.md` first.
- Name only the current verifier version, 0.15.0. Do not keep a history of
  older versions or of older deploys in a doc: git has that history.
- Do not keep a plan or a work log in `docs/`. When the work ships, move its
  facts to the document or the README that owns them, and delete the plan.
- Write in ASD-STE100 Simplified Technical English: short sentences, active
  voice, one idea in each sentence.
