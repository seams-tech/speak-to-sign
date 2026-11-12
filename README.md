# Speak-to-Sign

**Approve a blockchain call by saying it.**

You say one sentence, for example "Send 2 NEAR to alice.testnet". A verifier
in a TEE (a sealed part of a processor, which the hardware can prove) checks
two things: the voice is yours, and the words are that exact call. Only then
does the wallet sign. The contract checks the verifier's signed verdict again
on chain. So a changed web page or a prompt-injected agent cannot make you
sign a call that you did not say.

Speak-to-Sign is an entry for the NEAR hackathon. It runs on NEAR testnet
only.

| Start here | |
| --- | --- |
| Try it | <https://speak-to-sign.pages.dev/>, on a laptop with a microphone. It takes about 2 minutes. |
| Judges | [`JUDGES.md`](JUDGES.md): the short path to see it work and to check each claim. |
| Demo video | TODO: the owner adds the link to the demo video. |
| X post | TODO: the owner adds the link to the X post. |
| AI reviewers | [`AGENTS.md`](AGENTS.md): the read order and the facts that are easy to miss. |

## Contents

- [What you can do by voice](#what-you-can-do-by-voice)
- [Try it in 2 minutes](#try-it-in-2-minutes)
- [How it works](#how-it-works)
- [Why sign by voice](#why-sign-by-voice)
- [Check it yourself](#check-it-yourself)
- [Testnet facts](#testnet-facts)
- [Trust limits](#trust-limits)
- [Baseline and hackathon work](#baseline-and-hackathon-work)
- [Repository](#repository)
- [Built with](#built-with)
- [More to read](#more-to-read)

## What you can do by voice

The demo is community notes on a voice-controlled X.com-style page. The same
voice verifier also approves payments and multisig transfers.

| You do this | You say | What checks it |
| --- | --- | --- |
| Post a community note | A short summary of the note. | The verifier, Wallet core, and the contract `notes.seams-v1.testnet` |
| Rate a note | "This note is helpful" | The same |
| Bet on a note | "Bet 0.5 USDC yes on market 12" | The verifier, and the market contract `pm-notes.seams-v1.testnet`, which takes the USDC only with a verdict for that bettor, market, side and amount |
| Pay someone (`/pay/` of the demo site) | "Send 2 NEAR to alice.testnet" | The verifier and the Wallet. Above 10 NEAR, a passkey too. |
| Approve a multisig transfer | "Approve proposal 3: send 0.1 NEAR to seams-faucet.testnet" | The verifier, and the voice multisig contract. On 2026-11-12 two persons proposed, approved and executed one transfer by voice: [the live run](demo/contracts/voice-multisig/README.md#live-run-on-testnet). |

In the voice bar, JEV, an AI classifier, turns your words into a command (the
post, the side and the amount) and opens the correct sheet. JEV never
proposes or signs a payment. You approve the exact call when you say it.

## Try it in 2 minutes

You need a browser with passkeys and a microphone.

1. Open <https://speak-to-sign.pages.dev/>.
2. Do the three setup steps on the page: create a wallet (a passkey), set up
   your voice (three short clips), and get testnet NEAR and USDC (the
   faucet).
3. On a post, press **Write a note** and read the summary aloud. Or press
   **Bet** and read the bet aloud.
4. To see a refusal, read other words, or add or drop a "not". The card shows
   the reason and the words that the verifier heard. Nothing is signed.

[`JUDGES.md`, "See it in 2 minutes"](JUDGES.md#see-it-in-2-minutes) has each
step with the voice commands. To run the site on your own computer, use
`pnpm site`; [`demo/frontend/README.md`](demo/frontend/README.md) says what
it needs.

## How it works

### The parts

Each box is a part, and each group is a place that runs it. The audio leaves
your device only sealed to the verifier.

```mermaid
flowchart LR
  subgraph Device["Your device"]
    Page["Demo page"]
    Wallet["Speak-to-Sign module<br/>in Seams Wallet<br/>records and seals the audio,<br/>checks the verdict, signs"]
  end

  subgraph Seams["Seams servers"]
    Route["Verify route<br/>checks the TDX quote<br/>of the verifier call"]
  end

  subgraph OutLayer["OutLayer TEE (Intel TDX)"]
    Verifier["Voice verifier<br/>opens the audio, checks the voice<br/>and the words, signs the verdict"]
  end

  subgraph Models["Models"]
    Speaker["Is it your voice?<br/>ReDimNet on Phala (TDX)"]
    Whisper["Which words?<br/>Whisper on NEAR AI"]
  end

  subgraph Chain["NEAR testnet"]
    Contracts["Contracts: notes, market, multisig<br/>check the verdict again"]
  end

  Page --> Wallet
  Wallet -->|"sealed audio and the request"| Route
  Route --> Verifier
  Verifier -->|"audio"| Speaker
  Verifier -->|"audio"| Whisper
  Verifier -->|"signed verdict"| Route
  Route -->|"signed verdict"| Wallet
  Wallet -->|"signed call with the verdict"| Contracts
```

### One approval, step by step

```mermaid
sequenceDiagram
  actor You
  participant Wallet as Speak-to-Sign module in Seams Wallet
  participant Verifier as Verifier (OutLayer TEE)
  participant Speaker as Speaker model (Phala)
  participant Whisper as Whisper (NEAR AI)
  participant Contract as NEAR contract

  Wallet->>You: Show the sentence
  You->>Wallet: Say the sentence
  Wallet->>Verifier: 1. Sealed audio and the request
  par 2. Two models at the same time
    Verifier->>Speaker: Audio
    Speaker-->>Verifier: Voice embedding
  and
    Verifier->>Whisper: Audio
    Whisper-->>Verifier: Heard words
  end
  Verifier->>Verifier: 3. Check the voice, the words and that the audio is new
  Verifier-->>Wallet: 4. Signed verdict (accept, step_up or refuse)
  alt accept
    Wallet->>Wallet: 5. Check the verdict key and the request digest
    Wallet->>Contract: Signed call with the verdict
    Contract->>Contract: Check the verdict again
  else step_up
    Wallet->>You: Ask for a passkey too (a transfer above 10 NEAR)
  else refuse
    Wallet->>You: Show the reason and the heard words. Nothing is signed.
  end
```

The numbers in the diagram are these steps:

1. The Wallet records you and sends the audio and the typed request to the
   verifier, an OutLayer WASM worker (`seams-v1.testnet/voice-verifier`).
2. The verifier asks two models at the same time: a speaker model on Phala
   compares the voice with the voice that you enrolled, and Whisper on NEAR
   AI gives the words.
3. The verifier checks the heard words against the sentence of the request.
   It refuses words that add or drop a "not", and it refuses a recording that
   was used before.
4. The verifier signs a verdict. The verdict binds the speaker, the heard
   words and the digest of the exact request. It expires after 120 s.
5. Wallet core checks the verdict against a pinned key, then signs the call
   from your own account. The contract checks the verdict again on chain, so
   a bot with a plain NEAR key cannot skip the voice step over RPC.

The audio is sealed. From verifier 0.12.0, the device seals each recording to
a key that exists only inside the OutLayer TEE, and the servers between them
carry ciphertext. The verifier then sends the opened recording to the speaker
service (a Phala TDX VM, its key pinned) and to NEAR AI Whisper. The verifier
source (from 0.14.0) checks the TDX quotes of NEAR AI's gateway and of
Whisper inside the worker, and sends the recording only sealed to the checked
gateway. The live versions that the demo uses (0.12.0 and 0.13.0) do not have
this check yet ([state](docs/trust-chain.md#the-near-ai-check)).

The formats and the rules are in
[`docs/voice-intents-spec.md`](docs/voice-intents-spec.md).
[`docs/architecture.md`](docs/architecture.md) has the detailed diagrams:
enrollment, the decision in the verifier, what a verdict binds, the voice
multisig, the trust boundaries and the path of the audio.

## Why sign by voice

- **No blind signing.** A passkey click shows that a device approved
  something, not what the person agreed to. Here the Wallet signs only when
  the spoken words match the request, so the words of a phishing request do
  not match.
- **The loss that this stops.** On 21 February 2025, attackers took about
  US$1.5 billion from Bybit. They changed the Safe{Wallet} web page, so the
  multisig signers saw a normal transfer and signed a transaction that gave
  the attackers control. Here each signer says the request, and the verifier
  checks the heard words against the request that is signed. If a changed
  page shows other words, the words do not match, and the verifier refuses.
- **AI drafts and routes, and you approve.** NEAR AI drafts the note, and JEV
  routes your command. Neither can approve a call. Only your spoken sentence
  can.
- **One sentence is the approval, checked at two layers.** Off chain, the
  Seams verify route and the Wallet co-signer check the TDX quote of the
  verifier call at 0 gas, and they guard native NEAR transfers. On chain,
  `notes`, `pm-notes` and `voice-multisig` check the ed25519 verdict again
  ([who checks the verdict](docs/voice-intents-spec.md#9-who-checks-the-verdict)).
- **A voice clone alone signs nothing.** It works only on the person's own
  device, with the Wallet unlocked (see [Trust limits](#trust-limits)).

**How it differs.** Many entries guard agent spending with caps, policies or
an AI judge, and a large payment waits for a tap. Here the approval itself is
the spoken exact call ([`JUDGES.md`, "How it differs"](JUDGES.md#how-it-differs)).
[`docs/judge-questions.md`](docs/judge-questions.md) answers the doubts of a
strict review: voice clones, a compromised page or agent, JEV, spend guards
and who controls the verifier.

## Check it yourself

You can check the claims from a terminal, with no NEAR account and no keys.

| Step | What it proves |
| --- | --- |
| 1. The sentence and the signed bytes | The sentence that you say and the digest that is signed come from one request. |
| 2. The verifier | The rules of the voice check. For example, one changed word of a summary passes, and an added or dropped "not" does not. |
| 3. The verdict check | A verdict for one request does not pass for another request, another sentence or another recording. |
| 4. The notes contract | Each rule of the contract, in unit tests and in a local sandbox. The deployed code is a reproducible build of this source. |
| 5. Live testnet facts | The accounts, the code hashes and the verifier versions that are live now. |

- [`JUDGES.md`, "Check it from a terminal"](JUDGES.md#check-it-from-a-terminal)
  is the short form: each command with one line of expected result.
- [`docs/terminal-checks.md`](docs/terminal-checks.md) is the long form: each
  command with its whole output.
- [`JUDGES.md`, "Claim -> where to check it"](JUDGES.md#claim---where-to-check-it)
  names the test or the transaction for each claim.

## Testnet facts

### Contracts

Each contract runs a reproducible build: the notes contract the build of commit
`119ef0e` and the voice multisig the build of commit `99231f6` since
2026-11-12, and the note market and the faucet the builds of commit
[`777b844`](https://github.com/seams-tech/speak-to-sign/tree/777b84429096604e77e217480e9f89a398f5da13)
since 2026-11-11. SourceScan built each one again and got the same code hash.
The account link opens the contract page of NearBlocks, which shows the code
as verified.

| Contract | Testnet account | Source | Code hash (base58) |
| -------- | --------------- | ------ | ------------------ |
| Community notes | [`notes.seams-v1.testnet`](https://testnet.nearblocks.io/address/notes.seams-v1.testnet/contract) | [`demo/contracts/community-notes/`](demo/contracts/community-notes/) at commit `119ef0e` | `724jz1XPE5sEQU8HXMXf4Ub1WWem8csJyhAKSeabtU7c` |
| Voice multisig (version 3.0.0, voice only, 2 of 2 signers) | [`voice-multisig.seams-v1.testnet`](https://testnet.nearblocks.io/address/voice-multisig.seams-v1.testnet/contract) | [`demo/contracts/voice-multisig/`](demo/contracts/voice-multisig/) at commit `99231f6` | `CkYrt1XM3NDsdd7B8PVx2eyUh36nM3nQtmvbta8eQTnA` |
| Note market | [`pm-notes.seams-v1.testnet`](https://testnet.nearblocks.io/address/pm-notes.seams-v1.testnet/contract) | [`demo/contracts/jev-prediction-market/`](demo/contracts/jev-prediction-market/) | `7qA3mFHgGa31dsUJ3BjdCuh8yHS8jnnS79aMNPmSnQ9Z` |
| Faucet | [`seams-faucet.testnet`](https://testnet.nearblocks.io/address/seams-faucet.testnet/contract) | [`demo/contracts/faucet/`](demo/contracts/faucet/) | `6d8BGwTR88jjFFaYEfhnTnLaQet2FmRE3d5DvYxefR2z` |

The deploy transactions and the way to build each contract again are in
[`demo/contracts/README.md`](demo/contracts/README.md#the-deployed-code).

**The verifier.** The OutLayer project is `seams-v1.testnet/voice-verifier`.
Its verdict key is `ed25519:E8E53ydtc9LRvVz9xBCRrSzyBa5nh1gK1ts53Aoo751U`.
The key is bound to the project, and the Wallet and the contracts pin it.

| Version | State |
| --- | --- |
| 0.14.1 | On OutLayer, not active. It checks the TDX quotes of NEAR AI before it sends audio there. No caller selects it yet. |
| 0.14.1+venice | Active since 2026-11-12, because NEAR AI Whisper gave no reply: a call with no `version_key` runs it. It gets the words from Whisper on Venice AI, which has no TEE. Proposal 3 of the live multisig run used it. |

[`docs/deployed-state.md`](docs/deployed-state.md) says what is live now, where
it differs from the source, and the command that checks each part.
[`docs/testnet-facts.md`](docs/testnet-facts.md) has each version with its
hash and its transactions.

## Trust limits

These are the parties and the parts that you must trust today.
[`docs/threat-model.md`](docs/threat-model.md) has each attacker and what
stops it, and [`JUDGES.md`, "Not covered"](JUDGES.md#not-covered) lists what
is not done.

- **OutLayer.** The TEE run of pinned code, its storage of the template and the used audio, its signing key, and the NEAR AI secret. If OutLayer's TEE or governance fails, the verdict means nothing.
- **Project owner.** The owner of the OutLayer project can deploy a new version that signs with the same project-bound key. The Wallet pins the key, not the code.
- **NEAR AI.** The transcript has no signature of the model. A false transcript could pass the words check. The verifier source (0.14.0) checks that the transcript comes from NEAR AI's attested gateway; the live versions do not.
- **Phala.** The speaker service key comes from Phala's dstack KMS, per app ID. The Phala app owner can change the service code and keep the same key.
- **Sealed audio after the verifier.** The verifier sends the opened recording to the speaker service (a Phala TDX VM, its key pinned from its attestation) and to NEAR AI. The live versions (0.12.0 and 0.13.0) send it to NEAR AI over TLS and do not check NEAR AI's attestation. The verifier source (0.14.0) checks the TDX quotes of NEAR AI's gateway and of Whisper, and sends the recording only sealed to the checked gateway. That build is not live yet, and it still trusts the code of NEAR AI's VMs and the link from the gateway to Whisper ([details](docs/trust-chain.md#the-near-ai-check)).
- **Contract accounts.** Each of the four demo contract accounts still has a full-access key. Its holder can deploy new code, or name another moderator of the notes contract.
- **NEAR RPC.** The verifier reads the owner's access key from `test.rpc.fastnear.com` to check an enrollment authorization. It does not check a proof of that view.
- **Seams.** The Wallet and the Seams co-signer sign jointly. No contract limits a spoken payment; the policy step asks for a passkey above its amount.
- **Voice clones.** A voice clone works only on the person's own device, with the Wallet unlocked. VoiceID runs in the Wallet's isolated iframe on that device, and the keys stay there, so on another device a clone alone cannot unlock the Wallet (see [`docs/judge-questions.md`](docs/judge-questions.md), question 2). An attacker needs that device in hand (or malware that controls it) and an unlocked Wallet, and with those, the attacker can do much more harm than a voice clone. On that device, this build has no liveness check and no fresh words, and only a NEAR transfer above 10 NEAR also needs a passkey.
- **Synthetic voices.** A text-to-speech voice can enroll and pass. The verifier does not detect synthetic speech, and it does not refuse one voice on many accounts.

## Baseline and hackathon work

The hackathon project is Speak-to-Sign: the voice verifier (an OutLayer TEE
worker, with Whisper on NEAR AI Cloud and a speaker service on Phala), the
voice libraries, the demo, and the integration into Seams Wallet. All of this
repository was made in the hackathon window, from 2026-10-19 to 2026-11-14
(UTC).

Seams Wallet is a programmable embedded wallet that existed before the
hackathon. It is the baseline, not hackathon work.

- [`JUDGES.md`, "Scope of the hackathon work"](JUDGES.md#scope-of-the-hackathon-work)
  says which part is which.
- [`docs/hackathon-scope.md`](docs/hackathon-scope.md) gives the first commit
  of each part, with the command that prints it, and the diff of the Wallet
  in the window.

## Repository

| Folder | What it is |
| ------ | ---------- |
| `crates/spoken-intent/` | The `no_std` crate that renders a spoken request into canonical English, computes its request and spoken-text digests, and reads transcripts. Its golden vectors check the Wallet's TypeScript ports. |
| `crates/voice-verifier/` | The OutLayer worker: `enroll`, `verify`, `select`, `transcribe`, `detect` and `audio_key`. `scripts/fastfs_chunks.py` splits its WASM for the FastFS upload. See its README. |
| `crates/speaker-service/` | ReDimNet speaker embeddings in a Phala dstack CVM, signed replies. |
| `packages/voice-sign/` | `@seams/voice-sign`, the library for an application with no wallet: record a sentence, call the verifier, check the verdict. It joins `voice-capture` and `voice-verdict`. |
| `packages/voice-capture/` | `@seams/voice-capture`: records one spoken sentence in the browser. |
| `packages/voice-verdict/` | `@seams/voice-verdict`: checks a signed verdict, a signed transcript and the TDX quote of a call, and seals a recording to the verifier (`sealAudio`). One dependency, the cipher `@noble/ciphers`. |
| `crates/voice-verdict/` | The verdict check in Rust, for a server or a contract. |
| `examples/voice-confirm/` | A Web2 page and server with no wallet: enroll a voice and confirm an action. |
| `demo/frontend/` | The demo page, at <https://speak-to-sign.pages.dev/>: post, rate and bet on community notes by voice. See its README. |
| `demo/contracts/community-notes/` | The NEAR contract `notes.seams-v1.testnet` for the demo: `add_note`, `rate_note` and the views. See its README. |
| `demo/contracts/jev-prediction-market/` | The note market `pm-notes.seams-v1.testnet`: parimutuel bets in testnet USDC on a community note, resolved by JEV through OutLayer (`resolver/`), with a JEV-weighted payout. See its README. |
| `demo/contracts/voice-multisig/` | The voice-only multisig, version 3.0.0, on `voice-multisig.seams-v1.testnet`: M of N signers propose and approve a NEAR transfer or the hide of a note, each by voice. The older account `multisig.seams-v1.testnet` (version 2.x, with two admins that approved by key) was deleted on 2026-11-12. Its page is `/multisig/` of the demo source (`demo/frontend/src/multisig/`). Its README has the live run on testnet. |
| `demo/contracts/faucet/` | The faucet `seams-faucet.testnet`: 0.2 NEAR and 2 testnet USDC for a new account, once. See its README. |
| `examples/speak-to-pay/` | Speak to pay: a web page that pays a NEAR testnet account by voice, served at `/pay/` of the demo site. See its README. |
| `research/gate0/` | The Gate 0 feasibility probes and the HTTPS latency probe (`voice-probe/`). Evidence, not product. |
| `AGENTS.md` | A guide for AI agents: the read order and the facts that are easy to miss. |
| `docs/` | The specs, with an index in `docs/README.md`. |

## Built with

- Own baseline: the Seams Wallet SDK (`@seams/wallet`) and its Router A/B
  signing. The SDK package `@seams/voiceid` and the Speak-to-Sign flow in
  `@seams/wallet` were made in the window (see the table).
- Rust: `near-sdk` 5.30.1, `near-workspaces` 0.24.0 (sandbox test only),
  `outlayer` 0.2.1, `wasi` 0.13.3, `ed25519-dalek` 2, `sha2` 0.10.9, `borsh`
  1.6.1, `serde`, `serde_json`, `base64`.
- Web: React 19, Vite 8, Wrangler 4 (Cloudflare Pages).
- Services: OutLayer (TEE workers, FastFS), NEAR AI Cloud (Whisper large-v3),
  Phala dstack CVM (ReDimNet B1 speaker embeddings), NEAR testnet RPC.
- AI coding agents (Claude Code and Codex) wrote parts of the code.

## More to read

- [`docs/README.md`](docs/README.md): the index of the specs. Each document
  answers one question.
- [`crates/voice-verifier/README.md`](crates/voice-verifier/README.md): the
  verifier, its inputs and each of its versions.
- [`demo/contracts/README.md`](demo/contracts/README.md): the four contracts,
  their deploys and the reproducible build.
- The three libraries for an application with no wallet
  (`@seams/voice-verdict`, `@seams/voice-capture`, `@seams/voice-sign`) are on
  npm at 0.69.2, the same version as `@seams/wallet`.
- Design records in other Seams repositories:
  `seams-wallet/docs/refactor-227-speak-to-sign-without-passkey.md`,
  `seams-monorepo/docs/refactor-210-voice-intents.md`, and
  `seams-monorepo/docs/evidence/refactor-210-gate0/` (the Gate 0 results, the
  HTTPS latency records and the Phala speaker attestation).

The code is under the Apache License 2.0 ([`LICENSE`](LICENSE)).
