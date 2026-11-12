# The specs of Speak-to-Sign

Start with [`AGENTS.md`](../AGENTS.md) or [`JUDGES.md`](../JUDGES.md). Each
document below answers one question. Each fact has one home; other documents
link to it.

| Document | Read it to learn |
| --- | --- |
| [`judge-questions.md`](judge-questions.md) | Why the design is as it is: why voice, voice clones, JEV, spend guards, what is new, and life after the hackathon. |
| [`threat-model.md`](threat-model.md) | Each attacker, what stops it, the evidence, and what is left. |
| [`trust-chain.md`](trust-chain.md) | Each link from the microphone to the signed call: what proves it, who checks it, and its state. |
| [`deployed-state.md`](deployed-state.md) | What is live on testnet, where it differs from the source, and the command that checks each part. |
| [`testnet-facts.md`](testnet-facts.md) | Each verifier version that the project used, with its hash and its transactions, and the history of the demo accounts. |
| [`terminal-checks.md`](terminal-checks.md) | The checks that run in a terminal, with the whole output of each command. |
| [`hackathon-scope.md`](hackathon-scope.md) | The first commit of each part, and the diff of the Wallet in the hackathon window. |
| [`voice-intents-spec.md`](voice-intents-spec.md) | The formats and the rules: requests, sentences, digests, sealed audio, enrollment, verification, the verdict, who checks it, and the multisig. |
| [`architecture.md`](architecture.md) | Diagrams of the parts and the flows. Section 8.1 records the decision about the verdict key and the TDX quote. Section 9 follows the audio. |
| [`standalone-library.md`](standalone-library.md) | What a third party can check and use without Seams Wallet, and the plan for the libraries (2026-11-10). |
| [`voice-capture-package.md`](voice-capture-package.md) | The `@seams/voice-capture` package: what moved out of VoiceID, and its release steps. |
| [`note-summary-plan.md`](note-summary-plan.md) | The decision that the Seams server writes the spoken summary of a note, and the TEE checks it (released in 0.69.0). |

The READMEs next to the code give the details of each part:
`crates/voice-verifier/README.md` (the verifier and its versions),
`packages/*/README.md` (the libraries) and `demo/contracts/*/README.md` (each
contract and its deploys).
