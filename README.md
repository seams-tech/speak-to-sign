# Speak to Sign

Speak to Sign lets the owner of a NEAR account approve a payment by saying it
aloud. A verifier in a TEE hears the audio. It checks the speaker and the
words against one typed request, and signs a verdict. The Seams Wallet checks
that verdict and signs the transfer from the owner's own account, with no
confirm and no passkey. A policy rule can ask for a passkey. This repository
holds the verifier, the speaker service and the Gate 0 probes. Testnet only.

## Design in five lines

1. The Wallet records the owner and sends the audio and the typed request to the Seams verify route, which calls the verifier over OutLayer's HTTPS API.
2. The verifier (`seams-v1.testnet/voice-verifier`, an OutLayer WASM worker) calls the Phala speaker service and NEAR AI Whisper at the same time.
3. It compares the speaker embedding with the owner's template (cutoff 0.45), checks the heard words against the text of the request, runs the policy step and marks the audio as used.
4. It returns a verdict signed with a project-bound ed25519 key. The verdict expires after 120 s. Its outcome is `accept`, `step_up` or `refuse`.
5. Wallet core checks the verdict against the key that the Wallet pins, then signs the transfer through the owner's Wallet Session. On `step_up`, the owner approves again.

Design and record: `seams-wallet/docs/refactor-227-speak-to-sign-without-passkey.md`
and `seams-monorepo/docs/refactor-210-voice-intents.md`.

## Repository

| Folder                   | What it is                                                         |
| ------------------------ | ------------------------------------------------------------------ |
| `voice-verifier/`        | The OutLayer worker: `enroll` and `verify`. See its README.        |
| `speaker-service/`       | ReDimNet speaker embeddings in a Phala dstack CVM, signed replies. |
| `gate0/`, `voice-probe/` | Gate 0 probes, the FastFS uploader and the HTTPS latency probe.    |
| `examples/speak-to-pay/` | A web page that pays a NEAR testnet account by voice. See its README. |

## Testnet facts

| Item                | Value                                                                                        |
| ------------------- | -------------------------------------------------------------------------------------------- |
| Verifier            | `seams-v1.testnet/voice-verifier`, version 0.3.1, `5b6fad5df11440847e13508f57736da8de371526824cf12178dfc20be2c9c1d1` |
| Verifier with notes | version 0.4.0, `8a0b7ba0dff61a4b45e5d1d164c011525e11fe9f4fd02a4e22368882447329ef`, added 2026-11-09 and not active (FastFS tx `GPzHTAuC2VADuGR46ks7Mij8oPcZ4xVW9h7VuEkyqfuh`, `add_version` tx `9k7qWvG1JcCVyfzRjWjbWsjdK5MjXwQQ7vh71rT8me7y`). It adds `community_note` and `note_rating`; transfers are unchanged. A caller selects it by `version_key`. |
| HTTPS API           | `https://testnet-api.outlayer.ai/call/seams-v1.testnet/voice-verifier`                       |
| `secrets_ref`       | `{"profile":"main","account_id":"cyan-loong.testnet"}`                                       |
| Verdict key         | `ed25519:E8E53ydtc9LRvVz9xBCRrSzyBa5nh1gK1ts53Aoo751U` (bound to the project, pinned in the Wallet) |

## Trust limits

- **OutLayer.** The TEE run of pinned code, its storage of the template and the used audio, its signing key, and the NEAR AI secret. If OutLayer's TEE or governance fails, the verdict means nothing.
- **Project owner.** The owner of the OutLayer project can deploy a new version that signs with the same project-bound key. The Wallet pins the key, not the code.
- **NEAR AI.** The gateway gives the transcript without a signature. A false transcript could pass the words check.
- **Phala.** The speaker service key comes from Phala's dstack KMS, per app ID. The Phala app owner can change the service code and keep the same key.
- **NEAR RPC.** The verifier reads the owner's access key from `test.rpc.fastnear.com` to check an enrollment authorization. It does not check a proof of that view.
- **Seams.** The Wallet and the Seams co-signer sign jointly. No contract limits a spoken payment; the policy step asks for a passkey above its amount.
- **Voice clones.** A good clone that a compromised device plays can pass. This build has no liveness check and no fresh words.

## Evidence

`seams-monorepo/docs/evidence/refactor-210-gate0/` holds the Gate 0 results,
the HTTPS latency records and the Phala speaker attestation.
