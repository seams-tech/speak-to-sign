# The chain of trust of one spoken approval

This page follows one spoken approval from the microphone to the signed
transaction. For each link, it says what proves the link, who checks that
proof, and the state on 2026-11-12. The details are in
[`architecture.md`](architecture.md) section 8.1 (the decision about the key
and the quote) and in [`voice-intents-spec.md`](voice-intents-spec.md)
section 9.1 (each checker). The live state is in
[`deployed-state.md`](deployed-state.md).

## The links

| # | Link | What proves it | Who checks the proof | State |
| --- | --- | --- | --- | --- |
| 1 | The device seals the recording | HPKE to the verifier's audio key. The owner and the operation are in the `aad`. | Only a run of this OutLayer project gets the private audio key (`PROTECTED_AUDIO_KEY`, made in the OutLayer keystore). The Wallet pins the public key. | Live |
| 2 | The verifier runs in a TEE (OutLayer, Intel TDX) | The TDX quote of each call. Its report data binds the WASM hash, the input and the output, and the verdict is in the output. | The Seams verify route, against the pinned WASM hash. It refuses with `attestation_<code>`. | Built: `seams-wallet` `dev` at `0b297e976` (`speakToSignAttestation.ts`). These docs do not record a deploy of the staging server yet. |
| 3 | The verifier is this source | The reproducible build: Docker gives the same SHA-256 as the OutLayer version | Anyone: JUDGES.md check 3 | Live |
| 4 | The speaker check runs in a TEE (Phala dstack CVM, Intel TDX) | The service signs each embedding with a key from its TDX attestation | The verifier pins that key (`SPEAKER_PINNED_KEY_HEX`), after a check of the attestation on 2026-11-07 | Live |
| 5 | The transcript comes from a TEE (NEAR AI Cloud, Whisper large-v3) | NEAR AI publishes an attestation report: Intel TDX quotes of its gateway and of the Whisper VM, on dstack, and NVIDIA GPU evidence for Whisper. The report does not name the TLS key of `cloud-api.near.ai`. | Nobody. The verifier does not check it, and the transcript has no signature. | **Built, not shipped** (decision of 2026-11-12). See [Why the NEAR AI check is not shipped](#why-the-near-ai-check-is-not-shipped). |
| 6 | The verdict | An ed25519 signature by the verdict key over the request digest, the audio digest, the heard words, the outcome and an expiry of 120 s | Wallet core, the Seams co-signer and the contracts, against the pinned key | Live |
| 7 | The Wallet signs only the matching call | Threshold signing with two parts: a co-signer on the device (in an origin-isolated iframe) and the Seams co-signer. Each builds the request itself and checks the verdict for it. | Each co-signer refuses a verdict for another request. A `step_up` verdict needs a passkey too. | Live |
| 8 | The contract takes only a spoken action | `voice-multisig` and `pm-notes` check the verdict and its key on chain, and count each verdict once | The contract itself | Live for these two. The notes contract has the check in its source only. |

## What the chain does not check

- **The verdict key does not name the build.** The keystore gives the key to
  every version of the project, so the key alone means "a version of this
  project signed". The quote check of link 2 closes this gap for each
  verdict that passes the Seams verify route. A verdict from a call that
  skipped the route gets the key check only.
- **The contracts do not check the TDX quote.** Through the Seams Wallet, the
  verify route checks the quote off chain before the Seams co-signer signs.
  The contracts then check the ed25519 verdict on chain. A signer that uses a
  plain key, not the Seams Wallet, gets the key check only.
  [Spec 9.1](voice-intents-spec.md#91-the-verdict-key-and-the-tdx-quote) gives
  the gas and size numbers.
- **The audio key is project-wide.** A new verifier version of the same
  project also gets the audio key and can open sealed audio. The OutLayer
  access rule "One build only" can limit the key to one WASM hash; it is not
  set.

## Who is trusted, not verified

- **The Seams team.** It can deploy both the verifier and the Seams server.
  The quote check of link 2 does not remove this trust.
- **Intel TDX** and its collateral, and the OutLayer worker image that
  `worker.outlayer.testnet` approves.
- **The Phala app owner.** It can change the speaker service and keep its key.
- **NEAR AI**, for the transcript, and for the claim that only its TEEs see
  the audio, including that TLS ends inside its gateway. Its attestation
  report is public: JUDGES.md check 5 reads it, but does not check it.

## Why the NEAR AI check is not shipped

A check of NEAR AI's attestation is built and tested in the verifier, on the
branch `claude/nearai-attestation-cache-8506f2` (commit `e8d7400`). It is not
on `dev`, and no verifier version on OutLayer has it.

**The design.**
- The verifier seals each transcription request with OHTTP to the key of the
  NEAR AI gateway. The gateway's ed25519 key signs that OHTTP key config.
- The gateway's TDX quote binds the ed25519 key and a fresh nonce from the
  verifier. The verifier checks the quote with `dcap-qvl` and Intel's
  collateral, which it fetches itself. It pins the gateway key, and it
  records the compose hash but does not pin it, because NEAR AI deploys
  often.
- The verifier keeps the checked result in the worker storage for 6 h. After
  that, a network failure of NEAR AI or of Intel's collateral service keeps
  the last good result for up to 24 h. A failed check, or a changed key,
  refuses at once.
- Not checked by this design: the link from the gateway to Whisper (the
  gateway itself checks Whisper's TDX and GPU attestation and pins its TLS
  key), and the NVIDIA GPU attestation.

**The numbers** (testnet, 2026-11-12):
- An OHTTP transcription took 1.41–1.45 s, against 1.50–1.52 s for plain
  HTTPS.
- A normal call adds one storage read and about 10 ms of sealing. A new check
  takes about 2–4 s, once in 6 h.

**The cost that stopped it.** The quote check (`dcap-qvl`, X.509, P-256)
doubles the verifier WASM: 1,062,153 bytes, against 548,960 for 0.13.0.
OutLayer has a fixed time per call that grows with the WASM size: about 1 s
per MB, from earlier OutLayer timings. So the check can add about 0.5 s to
every spoken approval. `build.sh` also refuses a WASM of 1,000,000 bytes or
more.

**The two ways to ship it later:**
- **A. One WASM.** Raise the size limit, add the build as a version that is
  not active, measure its time against 0.13.0 with `version_key`, and decide
  from the numbers.
- **B. Split.** The verifier keeps only the OHTTP seal and a read of the check
  result (588,877 bytes, about 0 s added). A small checker version in the same
  OutLayer project runs the quote check from a scheduled call every 6 h, and
  writes the result to the shared worker storage. This adds two versions, a
  schedule and route changes, and it fails closed if the schedule stops for
  24 h.

**Decision.** On 2026-11-12, the owner decided not to ship it, and to record
this tradeoff. So NEAR AI stays trusted, as listed above.

The attacks that these gaps allow, and what stops each one, are in
[`threat-model.md`](threat-model.md).
