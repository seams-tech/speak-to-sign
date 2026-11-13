# The specs of Speak-to-Sign

Start with [`AGENTS.md`](../AGENTS.md) or [`JUDGES.md`](../JUDGES.md). Each
document below answers one question. Each fact has one home; other documents
link to it.

## Why, and what can go wrong

| Document | Read it to learn |
| --- | --- |
| [`judge-questions.md`](judge-questions.md) | Why the design is as it is: why voice, voice clones, JEV, spend guards, what is new, and life after the hackathon. |
| [`threat-model.md`](threat-model.md) | Each attacker, what stops it, the evidence, and what is left. |
| [`trust-chain.md`](trust-chain.md) | Each link from the microphone to the signed call: what proves it, who checks it, and its state. It is the home of the trust limits. |

## How it works

| Document | Read it to learn |
| --- | --- |
| [`voice-intents-spec.md`](voice-intents-spec.md) | The formats and the rules: requests, sentences, digests, sealed audio, enrollment, verification, the verdict, who checks it, and the multisig. |
| [`architecture.md`](architecture.md) | Diagrams of the parts and the flows. Section 8.1 records the decision about the verdict key and the TDX quote. Section 9 follows the audio. |

## What is live, and how to check it

| Document | Read it to learn |
| --- | --- |
| [`deployed-state.md`](deployed-state.md) | What is live on testnet, where it differs from the source, and the command that checks each part. |
| [`terminal-checks.md`](terminal-checks.md) | The checks that run in a terminal, with the whole output of each command. |
| [`hackathon-scope.md`](hackathon-scope.md) | The first commit of each part, and the diff of the Wallet in the hackathon window. |

## Next to the code

| README | What it holds |
| --- | --- |
| [`crates/voice-verifier/README.md`](../crates/voice-verifier/README.md) | The verifier: each version with its hash and its transactions, the build, the inputs and each check. |
| `packages/*/README.md` | The three libraries for an application with no wallet. |
| `demo/contracts/*/README.md` | Each contract and its deploys. |
| [`demo/frontend/README.md`](../demo/frontend/README.md) | The demo site: how to run it, its settings and its deploy. |

A plan or a work log does not stay here. When the work ships, its facts move
to the document or the README that owns them, and the plan goes away.
