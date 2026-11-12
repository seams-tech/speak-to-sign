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
| 5 | The transcript comes from a TEE (NEAR AI Cloud, Whisper large-v3) | The Intel TDX quotes of NEAR AI's gateway and of its Whisper VM, each with a fresh nonce of the verifier. The gateway's quote names the gateway key, and that key signs the key to which the verifier seals each recording (Oblivious HTTP). So only the gateway's TDX VM opens the request, and the sealed reply comes from that VM. | The verifier, from 0.14.0: it checks both quotes with Intel's collateral, at least each 6 hours, before it sends a recording. It refuses with `transcriber_not_attested`. | **In the source on `dev`, not in the live versions.** 0.12.0 and 0.13.0 send the audio over TLS and check nothing about NEAR AI. See [The NEAR AI check](#the-near-ai-check). |
| 6 | The verdict | An ed25519 signature by the verdict key over the request digest, the audio digest, the heard words, the outcome and an expiry of 120 s | Wallet core, the Seams co-signer and the contracts, against the pinned key | Live |
| 7 | The Wallet signs only the matching call | Threshold signing with two parts: a co-signer on the device (in an origin-isolated iframe) and the Seams co-signer. Each builds the request itself and checks the verdict for it. This also guards actions with no receiver contract code, such as native NEAR transfers (`examples/speak-to-pay`). | Each co-signer refuses a verdict for another request. A `step_up` verdict needs a passkey too. | Live |
| 8 | The contract takes only a spoken action | `notes`, `pm-notes` and `voice-multisig` check the ed25519 verdict and its key on chain, and count each verdict once, so a plain NEAR key outside Seams Wallet cannot skip the voice rule | The contract itself ([spec 9](voice-intents-spec.md#9-who-checks-the-verdict)) | Live |

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
- **NEAR AI.** The live verifier versions (0.12.0 and 0.13.0) trust it for
  the transcript, and for the claim that only its TEEs see the audio. The
  verifier source on `dev` (0.14.0) checks the TDX quotes of its gateway and
  of Whisper, and seals the audio to the gateway. Then this is left: the
  code of NEAR AI's VMs, the link from its gateway to Whisper, and a
  correct transcript, because the transcript has no signature of the model.
  See [The NEAR AI check](#the-near-ai-check).

<a id="why-the-near-ai-check-is-not-shipped"></a>

## The NEAR AI check

The verifier source on `dev` (from version 0.14.0) checks NEAR AI's attestation
inside the OutLayer worker, and sends each recording to Whisper only sealed
to the gateway that it checked. The details are in the
[verifier README](../crates/voice-verifier/README.md#near-ai-attestation).

**The state.**
- The check is in the source and its tests pass. The versions that run for
  users do not have it: 0.12.0 is the active version, and the demo and the
  Seams staging server call 0.13.0. Both send the audio to NEAR AI over TLS
  and check nothing about NEAR AI.
- The worker with the check is on OutLayer as version 0.14.1 (`1e7c6968…`),
  not active, and no caller selects it yet. On 2026-11-12 its 0.14.0 build
  (`b9a315b7…`, the same worker before the `venice` fix, removed since)
  loaded 0.09 s
  faster than 0.13.0. In three `verify` calls it read the stored check and
  got the speaker reply. NEAR AI Whisper then gave no reply, so no sealed
  transcription ran on OutLayer yet. From a laptop, the sealed transcription
  and the full check passed against NEAR AI and Intel (the live tests of the
  crate).
- An earlier build of the check, with `dcap-qvl`, ran the full check inside
  OutLayer on 2026-11-12 and kept the result. That build is removed now.
- The live state is in [`deployed-state.md`](deployed-state.md).

**The design.**
- The verifier seals each transcription request with Oblivious HTTP (HPKE) to
  the key of the NEAR AI gateway. The gateway's ed25519 key signs that key
  configuration. Only the gateway's TDX VM opens the request, and it seals
  its reply to the same request.
- The gateway's TDX quote names the ed25519 key and a fresh nonce from the
  verifier. The verifier checks the quote with Intel's collateral, which it
  gets itself: the certificate chain to Intel's root, the revocation lists,
  the TCB status (`UpToDate` or `SWHardeningNeeded`), and no debug mode. It
  pins the gateway key. It records the compose hash but does not pin it,
  because NEAR AI deploys often.
- Whisper has its own TDX quote. The verifier checks it in the same way, with
  the same nonce.
- The verifier keeps the checked result in the worker storage for 6 hours.
  After that, a network failure of NEAR AI or of Intel's collateral service
  keeps the last good result for up to 24 hours. A failed check, or a reply
  that does not open, refuses at once with `transcriber_not_attested`. No
  recording goes to NEAR AI without a checked gateway.

**What the check does not cover.**
- The code of NEAR AI's VMs. The verifier records the compose hash and does
  not pin it.
- The link from the gateway to Whisper. The gateway itself checks Whisper's
  attestation and pins its TLS key. That is NEAR AI's code.
- The NVIDIA GPU evidence of Whisper.
- A correct transcript. The transcript has no signature of the model.
- The stored result is one record for all versions of the OutLayer project.
  A new version of the project can write it.
- The `venice` build. It is a second worker for a NEAR AI Whisper outage
  (0.14.1+venice on OutLayer, not active). It sends the recording to Venice
  AI over TLS and checks no TEE on that path. A caller selects it by its
  version key. A verdict of that build names it: `"verifier":"0.14.1+venice"`.
  On 2026-11-12 the two verdicts of
  [the live multisig run](../demo/contracts/voice-multisig/README.md#live-run-on-testnet)
  came from it.

**The cost.** OutLayer loads the WASM on each call, and the load time grows
with its size: about 2.3 ms for each KB on 2026-11-12. The first build with
the check was 1,038,333 bytes, against 548,960 for 0.13.0, and it took about
1.1 s more on each call. For that reason the owner decided on 2026-11-12 not
to ship it. Three changes then made the worker smaller: `wasm-opt` in the
build, the worker's own TDX quote check in place of `dcap-qvl`, and inputs
that are read without `serde` types. The build of `dev` is 494,721 bytes,
which is smaller than 0.13.0. The numbers are in the
[verifier README](../crates/voice-verifier/README.md#size-and-load-time).

**What is left before it is live.** The Seams staging server and the demo
must select the version with the check, and the Wallet must know the refusal
`transcriber_not_attested`. One sealed transcription must pass on OutLayer;
that needs a reply of NEAR AI Whisper. Until then, NEAR AI stays trusted for
the live versions, as listed above.

The attacks that these gaps allow, and what stops each one, are in
[`threat-model.md`](threat-model.md).
