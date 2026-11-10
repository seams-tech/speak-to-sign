# Speak-to-Sign as a standalone library: facts and plan

Date: 2026-11-10. Branch: `claude/standalone-library-3e4d17` (on top of
`spoken-general`, commit `bf04e00`).

This document has three parts. Part 1 states what a third party can check
today. Part 2 is the plan. Part 3 gives the order of the work and the
questions for the owner of the project.

Each fact has a mark:

- **M** (measured): the named file in this repository shows it.
- **I** (inferred): it follows from measured facts, but no file here proves it.
- **U** (unknown): this repository does not show it.

## 1. What a third party can check today

### 1.1 The verdict

| # | Fact | Mark | Where |
| --- | --- | --- | --- |
| 1 | The verifier signs `SHA-256("seams:outlayer:voice-verdict:v2" \|\| verdict JSON bytes)` with ed25519. | M | `crates/voice-verifier/src/output.rs:157`, `testdata/signed_verdict_v2.json` |
| 2 | The verdict has 13 fields. It binds the request digest, the digest of the spoken text, the audio digest, the outcome and the expiry (120 s). | M | `output.rs:98-123`, `config.rs:22` |
| 3 | The verdict does not name the owner. The owner is inside the request digest. | M | `output.rs:98-123`, `crates/spoken-intent/src/request.rs` |
| 4 | The verdict and the `verify` output hold no TDX quote, no code hash and no key id. The output holds only the public key. | M | `output.rs:198-216` |
| 5 | The verdict names the verifier version (`"verifier":"0.8.0"`). The worker writes this text itself. Nothing proves it. | M | `output.rs:131`, `config.rs:5` |
| 6 | Each recording passes one time (`audio:v2:<digest>`, set-if-absent). | M | `config.rs:139`, `docs/voice-intents-spec.md` section 5 |
| 7 | Two contracts check a verdict on chain: signature, kind, `accept`, expiry, request digest. The two files are the same. | M | `demo/contracts/voice-multisig/src/verdict.rs`, `demo/contracts/jev-prediction-market/src/verdict.rs` |
| 8 | No library outside the Wallet and the contracts checks a verdict. | M | The file list of `crates/` and `packages/` before this branch |

So a third party with a verdict, its signature and the public key can check
three things: the key signed these bytes, the verdict is not expired, and the
verdict is for a request digest that the third party computes itself.

### 1.2 The verdict key and the code

| # | Fact | Mark | Where |
| --- | --- | --- | --- |
| 9 | The worker signs with the OutLayer keystore key `verdict`. The manifest declares it with `bind: "project"`. | M | `crates/voice-verifier/src/wasm_host.rs:70-76`, `manifest/outlayer.json` |
| 10 | The key is the same for every version of the project. The owner of the OutLayer project can add a version that signs with the same key. | M (as a statement of the project) | `docs/voice-intents-spec.md` section 11, `crates/voice-verifier/README.md:268-274` |
| 11 | The keystore derives the key from the project and the caller. Over HTTPS, the caller is the owner of the payment key. So another payment key gives another verdict key and another storage cell. | M (as a statement), I (the consequence) | `config.rs:12-15`, `README.md:268-274`, `README.md:333` of the verifier |
| 12 | The OutLayer version key is the SHA-256 of the WASM. The build is reproducible on x86_64 Linux. | M (documented; not built again for this report) | `crates/voice-verifier/README.md:44-106` |
| 13 | A verdict does not show which WASM version made it. A caller selects a version with `version_key`, or gets the active version. | M | `demo/frontend/functions/api/voice-verify.ts:71`, `README.md` "Testnet facts" |
| 14 | OutLayer gives a TDX quote for each HTTPS call. The reply has `attestation_url`. The record has the quote, the WASM hash, the input hash and the output hash. The first 32 bytes of the quote's report data are a SHA-256 over those values, the caller, the project and the time. `worker.outlayer.testnet` approves the five measurements. | M (one call on testnet, 2026-11-10) | `packages/voice-verdict/tests/fixtures/outlayer_attestation_testnet.json`, `packages/voice-verdict/src/attestation.ts` |
| 15 | OutLayer has a key that is bound to one build: `bind: "wasm"`. "The key belongs to this exact build and the caller. Issued only to a direct run of a wasm URL." This repository uses only `bind: "project"`. | M (the SDK text; not run) | `outlayer` 0.2.1 on crates.io, `src/signing_keys.rs:20-26` |

Fact 14 was unknown at the first report. It is measured now (section 4),
and it closes this gap with no change to the verifier: the quote of a call
binds the output, and so the verdict, to one WASM hash.

Without the quote, the chain from the verdict key to the code has a gap. A
third party must trust three parties for it: OutLayer (the TEE, the keystore and the rule
that only project versions get the key), the owner of the project (the
versions that exist), and the owner of the payment key (the version that a
call selects).

### 1.3 The speaker service

| # | Fact | Mark | Where |
| --- | --- | --- | --- |
| 16 | `GET /v1/attestation` returns the public key, the model digest, the TDX quote and the dstack signature chain. `report_data = SHA-256("seams:speaker-service:v1" \|\| public_key \|\| model_sha256)`. | M | `crates/speaker-service/src/main.rs:105-140`, `src/lib.rs:144-150` |
| 17 | Each embedding has a signature over the audio digest, the nonce, the model digest and the embedding. The verifier checks all of them. | M | `crates/voice-verifier/src/speaker_client.rs`, spec section 7.1 |
| 18 | The verifier does not read the quote at run time. It pins the service key as a constant. A person checked the attestation on 2026-11-07. | M | `crates/voice-verifier/src/config.rs:38-41` |
| 19 | The record of that check is in another repository (`seams-monorepo/docs/evidence/refactor-210-gate0/`). | M (the pointer), U (the content) | `README.md:523-524` |
| 20 | The owner of the Phala app can change the service code and keep the same key. | M (as a statement) | `README.md` "Trust limits" |

### 1.4 The other inputs

| # | Fact | Mark | Where |
| --- | --- | --- | --- |
| 21 | The transcript from NEAR AI has no signature. | M (as a statement) | spec section 11, `src/transcriber.rs` |
| 22 | Enrollment needs a NEP-413 signature by a full-access key of the owner. The verifier reads the key from one NEAR RPC and checks no proof. | M | `src/authorization.rs`, `src/ops/enroll.rs:48-95`, `config.rs:61-71` |
| 23 | The owner must be a NEAR account. `enroll` and `verify` refuse any other owner text. Every request kind holds `network` and a `NearAccount` owner. | M | `src/ops/enroll.rs:48`, `src/ops/request.rs:40`, `spoken-intent/src/request.rs` |
| 24 | The general kinds exist: `Transaction` (tag 8) and `SignedMessage` (tag 9). Each one is a spoken summary and a SHA-256 digest. The digest is of NEAR bytes. | M | `spoken-intent/src/request.rs`, `src/input.rs:98-113` |
| 25 | The general kinds are not on OutLayer. Version 0.8.0 is not built there. | M | `crates/voice-verifier/README.md:28` |
| 26 | The npm package `@seams/speak-to-sign` needs `@seams/wallet` and `@seams/voiceid`. | M | `packages/speak-to-sign/package.json:40-43` |
| 27 | The audio capture (16 kHz WAV, voice activity) is in `@seams/voiceid`, in another repository. | I | `docs/architecture.md` section 1 |
| 28 | The HTTP entry is the OutLayer call with one payment key. The Seams route and the demo route hold that key. No key per developer exists. | M | `demo/frontend/functions/api/voice-verify.ts` |
| 29 | No liveness check and no fresh words exist. A good clone of the voice, played once, can pass. | M (as a statement) | spec section 11 |

### 1.5 Summary: checked or trusted

A third party **can check** today:

- the signature of a verdict against a public key that it got from Seams;
- that the verdict is for its own request digest and is not expired;
- that a WASM hash comes from this source (it builds the WASM again);
- that the speaker service key is in a valid TDX quote (it reads
  `/v1/attestation` and checks the quote with Intel's roots).

A third party **must trust** today:

- that the verdict key signs only inside the pinned verifier code (OutLayer,
  the project owner, the payment-key owner);
- that the Phala app did not change after the pinned check;
- the transcript of NEAR AI;
- the NEAR RPC view at enrollment;
- that the voice is live and is not a clone.

## 2. Plan

### 2.1 Product statement

Speak-to-Sign proves one thing: an enrolled person said one known sentence,
and an attested service checked the speaker and the words and signed a
verdict for exactly one request. The application gives the request and its
sentence. The library gives the proof that the owner of the voice confirmed
it. Speak-to-Sign does not find the intent in free speech: it is not general
speech-to-text and it does not detect an intent that the application did not
supply. It does not prove that the voice is live: a good clone or a new
recording of a clone can pass, and only a reused recording is refused. It
does not prove that the summary of a general request describes the payload.

### 2.2 Public surface

Sizes: **S** = some hours, **M** = one to three days, **L** = a week or more.
"Breaks" names the wire formats: verdict v2, the `SpokenRequestV1` tags, the
verifier input, and the Wallet integration on `spoken-general`.

#### (a) A chain-neutral request

- **Exists:** tags 8 and 9 are "a summary and a digest", but they hold
  `network` and a NEAR owner, and their digests are of NEAR bytes.
- **Change:**
  1. Add one kind to `SpokenRequestV1`, tag 10, `Attestation`:
     `{ owner: OwnerId, context: String, payload_sha256: [u8; 32], summary: SpokenSummary }`.
     `context` is a short name that the application selects (for example
     `example.com/login` or `eip155:1`). It separates applications, so a
     verdict for one application has no use in another.
  2. Add `OwnerId`: a text with a scheme prefix, for example
     `near:alice.testnet`, `ed25519:<base58 key>`, `eip155:<address>`,
     `app:<developer id>:<user id>`. A NEAR account name cannot hold ":", so
     the new owners cannot collide with the stored templates.
  3. Add the verifier kind `{"kind":"attestation","context","payload_sha256_hex","summary"}`.
  4. Add the kind to the golden vectors and to each port.
- **Size:** M (crate, verifier, vectors, tests).
- **Breaks:** nothing. Borsh writes explicit tags, so tags 1 to 9 keep their
  digests. Verdict v2 does not change. The verifier input gets one new
  `kind`; a verifier before this version refuses it as `unsupported`. The
  Wallet integration does not change. It needs a new verifier version on
  OutLayer (a deploy).

#### (b) A small verdict-check library, and what a contract needs

- **Exists:** the check is in the Wallet (TypeScript, not public by itself)
  and in two copies of `verdict.rs` in the demo contracts.
- **Change:**
  1. TypeScript package `packages/voice-verdict` with no dependency. **Done
     in this branch** (section 3, slice 1).
  2. Rust crate `crates/voice-verdict`, with a function that takes the
     ed25519 check as a parameter, so a NEAR contract can pass
     `env::ed25519_verify`. **Done in this branch.**
  3. Later: the two demo contracts use the crate and delete their copies.
     This touches files of the demo sessions, so it is not in this branch.
  4. Later: request encoders (Borsh of tags 8, 9 and 10) in the TypeScript
     package, so a developer does not need the Rust crate for the digest.
- **A contract needs:** the 32-byte verifier key in its state (with a method
  to change it), the request digest that it computes from its own state and
  the caller, `check_verdict`, and its own guard against a second use of one
  verdict if the action is not idempotent. The verdict has no nonce: within
  120 s the same verdict passes again.
- **Size:** S (done), then S for each later item.
- **Breaks:** nothing. The library reads verdict v2 as it is.

#### (c) The chain from the verdict key to the attested code

This is the largest gap (facts 9 to 15). Three ways exist. They can be
combined.

1. **Publish the evidence that exists (S, no break).** One document and one
   script in this repository:
   - the verdict key, the project, and each version key with its commit;
   - the command that builds the WASM again and compares the hash;
   - a script that reads `/v1/attestation` of the speaker service, checks
     the TDX quote, compares `report_data`, and compares the key with
     `SPEAKER_PINNED_KEY_HEX` of the commit;
   - the measurements that the reader must compare: for the speaker service
     the dstack `compose-hash` and the `os-image-hash` (from the dstack event
     log in the quote), and the model digest; for the verifier the WASM hash.
   This does not close the gap of facts 10 and 13. It makes the trust
   explicit and makes the speaker side checkable.
2. **Bind the key to the code on OutLayer (M to L, breaks the pin).**
   OutLayer has `bind: "wasm"` (fact 15): the key then belongs to one exact
   build. Each verifier build gets its own key. Two things are open:
   - `bind: "wasm"` is issued only to a direct run of a WASM URL, not to a
     run through the project. The effect on the HTTPS call, the storage cell
     and the secrets is unknown (U). It needs a probe.
   - A third party still needs a quote that shows the keystore rule (fact
     14, U). With it, the verify output can carry `attestation` (not signed,
     outside `verdict_json`), and the check library gets `checkAttestation`.
   Each new build changes the key. So the Wallet and each contract need a
   list of keys. A small NEAR registry contract (WASM hash, key, state) fits
   here. This changes the Wallet integration.
3. **Run the verifier in its own TDX machine (L, breaks the pin).** The
   verifier becomes a dstack service, as the speaker service is. Its key
   comes from the dstack KMS, and `/v1/attestation` gives a quote with
   `report_data = SHA-256(domain || verdict key || config digest)`. A third
   party then checks one quote and one `compose-hash`. The verifier loses the
   OutLayer storage and keystore and needs its own. The same Phala limit
   stays: the owner of the app can change the code and keep the key, unless
   an on-chain KMS policy controls the `compose-hash`.

For each way, a third party checks: the quote signature (Intel TDX roots),
the measurements against published values, `report_data` against the key,
and the key against the verdict signature.

- **Breaks:** way 1: nothing. Ways 2 and 3: the pinned key changes (Wallet
  core, the co-signer, each contract), and the verify output gets a new
  field. Verdict v2 itself can stay.

#### (d) Enrollment without a NEAR key

- **Exists:** only NEP-413 by a full-access key of a NEAR account (fact 22).
- **Change:** add a `scheme` to `authorization`, selected by the `OwnerId`
  scheme of (a):
  - `ed25519:<key>` owner: a plain ed25519 signature over
    `SHA-256("seams:voice-enrollment:v3" || owner || 0x00 || d1 || d2 || d3)`.
    No RPC call. The key is the identity.
  - `eip155:<address>` owner: an EIP-191 or EIP-712 signature (secp256k1).
  - `app:<developer>:<user>` owner: the developer's API key authorizes the
    enrollment. The developer is then trusted for the identity of its users.
    The owner text holds the developer id, so one developer cannot enroll a
    voice for a user of another developer.
- **Size:** M for ed25519, M more for each other scheme.
- **Breaks:** the `enroll` input gets one optional field. An input without
  it means NEP-413, so the Wallet integration does not change. An old
  verifier refuses the new field (`deny_unknown_fields`). The enrollment
  digest domain for the new schemes is new (`v3`); `v2` stays for NEAR.

#### (e) Audio capture without the Wallet

- **Exists:** the capture is in `@seams/voiceid` (fact 27). The verifier
  accepts a 16 kHz mono PCM16 WAV of at most 8 s and has an energy gate
  (`config.rs:97-113`).
- **Change:** a small browser module (`packages/voice-capture` or an export
  of the new package): microphone, resample to 16 kHz, stop on silence,
  write the canonical 44-byte-header WAV, and run the same energy gate
  before the upload. Also a function that returns the audio digest, so the
  application can compare it with the verdict.
- **Size:** M. A React Native or native capture is separate work.
- **Breaks:** nothing.

#### (f) A hosted verifier API with a key for each developer

- **Exists:** one OutLayer project and one payment key. Seams routes hold it
  (fact 28). The verdict key and the storage cell depend on the payment key
  (fact 11).
- **Change, two options:**
  1. A Seams gateway: `POST /v1/enroll` and `POST /v1/verify` with an API key
     for each developer. The gateway calls OutLayer with the Seams payment
     key. All developers share one verdict key and one storage cell. The
     gateway must prefix the owner with the developer id (the `app:` scheme),
     apply limits, and count use. The gateway sees the audio.
  2. The developer brings an own OutLayer payment key. The developer then
     gets an own verdict key and an own storage cell, with no Seams server
     between. It needs the answer to: which secrets profile gives the
     NEAR AI key to such a call (U).
- **Size:** M for option 1 (route, keys, limits, a use counter), plus the
  operation of the service. S for the documents of option 2, if the secrets
  question has an answer.
- **Breaks:** nothing in the formats. It is a new service and needs a deploy.

### 2.3 What breaks, in one table

| Change | Verdict v2 | `SpokenRequestV1` tags 1 to 9 | Verifier input | Wallet on `spoken-general` |
| --- | --- | --- | --- | --- |
| (a) tag 10 and `OwnerId` | same | same | one new `kind` | same |
| (b) check libraries | same | same | same | same |
| (c) way 1, evidence | same | same | same | same |
| (c) ways 2 and 3 | same; the output gets `attestation` | same | same | **the pinned key changes** |
| (d) enrollment schemes | same | same | one optional field in `authorization` | same |
| (e) capture module | same | same | same | same |
| (f) hosted API | same | same | same | same |

A liveness check or fresh words (for the clone risk) would change the
sentence and the verdict. It is not in this plan.

### 2.4 Direction from the owner (2026-11-10)

The owner of the project gave four directions after the first report:

1. The library must serve Web2 developers, not only crypto developers.
2. It stays on NEAR infrastructure.
3. A consumer can get a TDX quote, as an option.
4. It also offers general speech-to-text or intent detection.

The owner agrees that the signed verdict is the product: "send audio and a
digest, get a verdict that any chain or server can check".

#### What each direction changes in the plan

**Web2.** The request of (a) and the `app:` owner of (d) become the main
path, not a later scheme:

- A Web2 user has no key. The developer's server authorizes the enrollment
  with its API key. The owner text is `app:<developer id>:<user id>`.
- The developer's server checks the verdict with `packages/voice-verdict`,
  as it checks a signed token with a life of 120 s. No chain, no wallet.
- `context` and `payload_sha256` bind the verdict to one action of one
  application (a login, a payment order, an approval of a change).
- The server must store each used `audio_digest` or request digest for
  120 s, if the action is not idempotent. The verdict has no nonce.

**NEAR infrastructure.** The verifier stays an OutLayer worker and the words
stay on NEAR AI. So (c) way 3 (an own TDX machine) is out. Two points need a
decision:

- The speaker model runs on Phala, which is not NEAR infrastructure. The
  worker has no model ("No `tract`, no ReDimNet in the worker",
  `crates/voice-verifier/README.md:7`). To move it, NEAR AI must host the
  speaker model, or the model must fit in an OutLayer worker.
- A gateway with API keys (option 1 of (f)) is a Seams server in front of
  OutLayer. The option with no server outside NEAR is option 2 of (f): each
  developer has an own OutLayer payment key.

**Optional TDX quote.** This is (c) way 2. The steps:

1. A probe: a small worker with one `bind: "wasm"` key, called as a direct
   run. It answers: does the HTTPS call work, which storage cell and which
   secrets does the run get, and what quote or attestation does OutLayer
   give for the run or for the keystore. `research/gate0/outlayer-probe` is
   the start. The probe is a deploy, so it needs a yes.
2. If a quote exists: a new operation `attest` (or a field in the verify
   input) returns `{public_key, wasm_sha256, quote}` beside the verdict.
   The verdict does not change.
3. `checkAttestation` in the check library: the quote signature, the
   measurements, the key in the quote data, and the WASM hash against a
   value that the consumer built or pinned.
4. A registry contract on NEAR with the valid builds and their keys.
5. The same for the two services that the worker calls. The speaker quote
   exists (fact 16). A signed or attested reply of NEAR AI for the audio
   endpoint is unknown (U).

If OutLayer gives no quote for a run, the consumer still gets way 1 (the
evidence) and the speaker quote. Then the honest name is "a verdict from a
TEE service", not "a TDX quote for each verdict".

**Speech-to-text and intent detection.** Today the verifier knows the
expected sentence before it listens. Three new operations are possible. They
have different strength, and the names must show that.

| Operation | Input | Signed result | Strength |
| --- | --- | --- | --- |
| `confirm` (today `verify`) | one request, audio | the verdict for that request | Strong: exact words, near misses refused |
| `select` (new) | 2 to 16 candidate requests, audio | the verdict for the one request whose sentence the owner said | As strong as `confirm`: the same word check, for each candidate. No language model |
| `transcribe` (new) | audio | speaker result, audio digest and the heard text | The text is what Whisper heard. No expected words, so no near-miss check |
| `detect` (new) | audio and a list of intent schemas | the heard text, the digest of the schemas, and one intent as JSON | A proposal. A language model on NEAR AI makes it. It can be wrong |

- `select` gives "intent detection" for a closed set of actions with no new
  trust: the application sends the actions that are possible now, and the
  verdict says which one the owner said. Size: M.
- `transcribe` gives a signed transcript with the speaker check ("this
  enrolled person said these words"). It needs a new signed kind
  (`seams_voice_signed_transcript_v1`), so a checker of verdict v2 cannot
  take a transcript for a confirmation. Size: M.
- `detect` needs a chat model call in the worker (the market resolver
  already calls one on NEAR AI). Size: L. Its result must not authorize an
  action with value by itself. The safe flow is: `detect` proposes, the
  application shows the sentence, and `confirm` approves it.
- The transcript and the model reply have no signature today (fact 21). So
  a TDX quote of the verifier does not cover them. The product statement
  must say this for `transcribe` and `detect`.

None of the three operations changes verdict v2, the request tags or the
Wallet integration. Each one is a new `op` of the verifier input.

## 3. Order of the work

The order below is from before the direction of section 2.4. Section 3.1
gives the order after it.

Each slice is useful by itself.

1. **Verdict-check library (done in this branch).** `packages/voice-verdict`
   (TypeScript, no dependency) and `crates/voice-verdict` (Rust). Tests use
   `crates/voice-verifier/testdata/signed_verdict_v2.json` and
   `crates/spoken-intent/fixtures/spoken_intent_vectors_v1.json`.
2. **Evidence and a check script** ((c) way 1). No deploy, no decision.
3. **The chain-neutral request** ((a)): tag 10, `OwnerId`, vectors, the
   verifier kind, and request encoders in the TypeScript package. The code
   needs no decision after question 1. It is of use only after a verifier
   deploy.
4. **Enrollment for an ed25519 owner** ((d)). It goes into the same verifier
   version as slice 3.
5. **Capture module** ((e)) and one example page with no Seams Wallet:
   enroll, say a summary, check the verdict with the package of slice 1.
6. **Hosted API** ((f)).
7. **Key bound to code** ((c) way 2 or 3). It needs the answers to
   questions 4 and 5.

### 3.1 Order after the direction of section 2.4

1. **Done:** the verdict-check library (TypeScript and Rust).
2. **Next, no deploy:** the chain-neutral request (tag 10, `OwnerId` with
   `app:` and `ed25519:`), the `app:` enrollment, the operation `select`,
   request encoders in the TypeScript package, and all vectors. One verifier
   version holds all of it. It is of use after one deploy.
3. **At the same time, needs a yes:** the OutLayer probe for `bind: "wasm"`
   and the quote. Its result decides the form of the optional quote.
4. **Then:** a capture module and one Web2 example with no wallet: enroll,
   confirm a login or an order, check the verdict on a server.
5. **Then:** the API for developers (gateway, or own payment key).
6. **Then:** `transcribe`, with a clear statement of its trust.
7. **Then:** the optional quote (`attest`, `checkAttestation`, registry),
   if the probe shows a quote.
8. **Last:** `detect`.

Answered by section 2.4: question 1 (the `app:` scheme comes first, for
Web2) and the first part of question 4 (stay on OutLayer).

### Questions that only the owner of the project can answer

1. **Owner identity.** Which schemes come first: a plain ed25519 key, an EVM
   address, or an id that the developer gives (`app:`)? The `app:` scheme
   makes the developer a trusted party for the identity.
2. **Names.** The npm scope and name of the check package
   (`@seams/voice-verdict` is the working name), and the crate name. Do they
   go to npm and crates.io?
3. **Hosted API.** Does Seams run a gateway with keys for each developer and
   pay OutLayer and NEAR AI, or do developers bring their own OutLayer
   payment key? What are the limits and the price?
4. **Attestation.** Is a changed verdict key acceptable (Wallet core, the
   co-signer and the contracts must follow)? If yes: stay on OutLayer and
   ask OutLayer for a version-bound key and a quote (facts 14 and 15), or
   move the verifier to its own TDX machine?
5. **OutLayer facts.** Can OutLayer give a quote for a run or for the
   keystore, and bind a key to one WASM hash? This needs a question to
   OutLayer or a probe, and the probe is a deploy.
6. **Mainnet.** The verifier serves testnet only. Is mainnet in the scope of
   the standalone library?
7. **Clone risk.** Is "attested confirmation, no liveness" the accepted
   product statement, or is a liveness step (fresh words) a requirement
   before other developers use it?
8. **Demo contracts.** May a later change replace the two copies of
   `verdict.rs` with the new crate? Those files belong to the demo sessions.
9. **Probe.** May a probe worker go to OutLayer testnet (a deploy) to
   measure `bind: "wasm"` and the quote?
10. **Speaker service.** Does "NEAR infrastructure" allow the speaker model
    on Phala, as it is today?
11. **Web2 trust.** For an `app:` owner, the developer is trusted for the
    identity of the user at enrollment. Is that acceptable?
12. **Intent detection.** Is `select` (a closed set, no language model)
    enough for the first version, with `detect` later?

## 4. State after the second round of work (2026-11-10)

The owner of the project answered the questions of section 3, and the work
of section 3.1 started. This section is the current state. Where it differs
from the sections above, this section is correct.

### 4.1 Decisions of the owner

| Question | Decision |
| --- | --- |
| Speaker model on Phala | Both: the model inside the OutLayer worker, and the model on Phala. Two variants of the worker |
| Other speaker models | The library must let a developer use another model, for example another ReDimNet |
| Probe on OutLayer testnet | Yes |
| Web2 trust | Accepted: the user trusts the developer for the identity |
| Intent detection | `confirm` and `select` first. Then `transcribe`, then `detect` |
| Developer API | No Seams gateway. Each developer brings an own OutLayer payment key and an own NEAR AI key |
| Package | `@seams/voice-verdict` is a separate package in this repository. `@seams/speak-to-sign` can import it |

### 4.2 What exists now

All of it is on the branch `claude/standalone-library-3e4d17`. Nothing is
pushed, published or deployed.

| Item | Where | Tests |
| --- | --- | --- |
| Verdict check (TypeScript, Rust) | `packages/voice-verdict`, `crates/voice-verdict` | Shared signed vectors |
| Application owner `app:<id>`, `Confirmation` (tag 10) | `crates/spoken-intent/src/owner.rs`, `request.rs` | 3 new golden vectors |
| Request kind `confirmation`, enrollment of an application owner | `crates/voice-verifier/src/ops/request.rs`, `enroll.rs` | `tests/ops/web2.rs` |
| Operation `select` | `crates/voice-verifier/src/ops/select.rs` | `tests/ops/web2.rs` |
| Operation `transcribe` | `crates/voice-verifier/src/ops/transcribe.rs` | `tests/ops/transcribe.rs`, shared vectors |
| Variant `local-speaker` (ReDimNet in the worker) | `crates/voice-verifier/src/local_model.rs`, `build.sh --local-speaker` | Fake host, and the real model in a native run |
| One constant for the speaker model | `config::SPEAKER_MODEL` | Existing tests |
| Request builder, verifier client, transcript check | `packages/voice-verdict/src/request.ts`, `client.ts`, `verdict.ts` | Golden vectors, fake OutLayer |
| Browser capture, WAV and energy gate | `packages/voice-verdict/src/capture.ts` | WAV and gate only |
| TDX quote of a call | `packages/voice-verdict/src/attestation.ts` | A real testnet attestation |
| Web2 example with no wallet | `examples/voice-confirm` | Run with its fake verifier |

### 4.3 The TDX quote: what the probe measured

No probe worker was needed. One call of the active verifier (0.5.2) with an
unknown operation gave these facts:

1. The reply of an HTTPS call has `attestation_url`
   (`/attestations/by-call/<call id>`). The record is public.
2. The record has `tdx_quote`, `wasm_hash`, `input_hash`, `output_hash`,
   `project_id`, `caller_account_id` (the owner of the payment key) and
   `timestamp`.
3. `wasm_hash` was `96b79b51…d7e5`: the version key of verifier 0.5.2 in the
   root README.
4. `input_hash` is the SHA-256 of the input JSON as sent. `output_hash` is
   the SHA-256 of the output JSON with sorted keys.
5. The first 32 bytes of the report data of the quote are
   `SHA-256(task_type || task_id || build_target || wasm_hash || input_hash
   || output_hash || caller || project || timestamp || attached_usd)`. The
   computed value was equal to the value in the quote. The formula is from
   the source of `outlayer-verify`.
6. `worker.outlayer.testnet` answered `true` to `is_measurements_approved`
   for the five measurements of the quote, and `false` after a change.

So the chain for a third party is: verdict → output of the call → output
hash → task hash → TDX quote → approved measurements; and WASM hash →
reproducible build → source. The verdict key is not in this chain.

Consequences:

- (c) way 2 (`bind: "wasm"`) is not needed. It also does not fit: a
  `bind: "wasm"` key is issued only to a direct run of a WASM URL, and the
  HTTPS API runs only projects.
- The quote is optional for the consumer. The verdict check stays the fast
  path.
- Not done in the package: the check of the quote's signature chain to
  Intel. It needs a DCAP verifier and Intel's collateral. `outlayer-verify`
  does it.
- Not covered by the quote: the transcript of NEAR AI (no signature), and,
  for the default variant, the Phala service (its own quote, fact 16). The
  `local-speaker` variant has no Phala service: its speaker model is inside
  the attested WASM run, with a pinned model digest.

### 4.4 The two variants and "NEAR infrastructure"

| | Default | `local-speaker` |
| --- | --- | --- |
| Outside NEAR | Phala (speaker) | The host of the model file |
| Trust in that host | Its key and its quote | None: the worker pins the SHA-256 of the file |
| WASM | about 0.45 MB | about 8.3 MB |
| Speed | Fast | Slower: Gate 0 measured 8 to 13 s of fixed time for a worker of this size |

The model file is on `test.sign.seams.sh` today. To be only on NEAR
infrastructure, put the file on FastFS and change `config::REDIMNET_B1.url`
and the manifest. That is an upload, so it is not done.

### 4.5 Not done, and why

1. **No verifier version with this work is on OutLayer.** The source is
   version 0.8.0. A deploy needs a yes: the reference build
   (`build.sh --docker` for each variant), the FastFS upload, `add_version`
   and a new version key. Until then, `confirmation`, `select`,
   `transcribe` and `local-speaker` ran only in tests with a fake host.
2. **`local-speaker` did not run on OutLayer.** The real model ran natively
   through the same code. The WASM builds. Its time and cost on OutLayer are
   not measured.
3. **`detect` is not built.** It needs a chat model call in the worker, a
   signed format for an intent, and a rule for the schema of the
   application. It is the weakest operation, so it comes last.
4. **The microphone path of the capture module ran in no test.** The WAV
   writer and the energy gate have tests.
5. **`crates/voice-verdict` has no transcript check, no request builder and
   no attestation check.** The TypeScript package has them.
6. **The Wallet's TypeScript port of `spoken-intent` does not know tag 10.**
   The golden file has three new requests. The Wallet tests that read the
   file can fail until the port has the kind, or skips it.
7. **`@seams/speak-to-sign` does not import `@seams/voice-verdict` yet.**
   The plugin has no verdict check of its own: Wallet core has it.
8. **The demo contracts keep their copies of `verdict.rs`.**

### 4.6 Capture and VoiceID (decision of the owner, 2026-11-10)

VoiceID stays in the `seams-wallet` repository, and `@seams/speak-to-sign`
keeps its dependency on it. No capture library is taken out of VoiceID. The
reason: the user must not enroll two times. Today `enroll` turns on VoiceID
and uses its three samples as the recordings of the verifier, and that
stays.

- Inside Seams Wallet, capture is the phrase surface of VoiceID. Item (e) of
  section 2.2 does not apply there.
- `packages/voice-verdict/src/capture.ts` was built before this decision. It
  holds no VoiceID code: it is a new WAV writer, the energy gate of the
  verifier and a plain recorder. It has no voice activity detection, no
  phrase tracking and no phrase card. Only `examples/voice-confirm` uses it.
- No more capture work is planned. For a developer with no Seams Wallet,
  capture is an open question (question 6 below).

### 4.7 Open questions

1. May verifier 0.8.0 go to OutLayer testnet, in both variants? The project
   is `seams-v1.testnet/voice-verifier`, and the key of its owner is needed.
2. May the model file go to FastFS, for the `local-speaker` variant?
3. Which other speaker models do you want first? Each one needs its file,
   its SHA-256 and a measured cutoff.
4. For `detect`: which chat model on NEAR AI, and is a proposal with no
   authority the correct contract?
5. Does `@seams/voice-verdict` go to npm now, or after the first deploy?
6. Capture for a developer with no Seams Wallet: does the small module
   `@seams/voice-verdict/capture` stay, or must it go, so that VoiceID is the
   only capture code? An application with its own recorder needs only the
   WAV format, which the verifier README states.
