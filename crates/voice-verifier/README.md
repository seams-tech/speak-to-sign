# seams-voice-verifier

OutLayer worker (`wasm32-wasip2`) for Speak-to-Sign (plan
`seams-wallet/docs/refactor-227-speak-to-sign-without-passkey.md`). The Seams
verify route calls it with
`POST https://testnet-api.outlayer.ai/call/seams-v1.testnet/voice-verifier`.
Operations: `enroll`, `verify`, `select`, `transcribe`, `detect` and `audio_key`. The default worker has no `tract` and no
ReDimNet: the speaker model runs in a service on Phala. The variant
`local-speaker` runs ReDimNet inside the worker (see "Two variants").

The verdict authorizes a payment from the owner's own account: the Wallet
checks it against the key that it pins and signs the transaction itself.
There is no vault contract.

## Versions

The source on this branch is version 0.15.0 (`config::VERIFIER_VERSION`). Its
two builds are on OutLayer:

| Version | OutLayer version key (WASM SHA-256) | State |
| ------- | ----------------------------------- | ----- |
| 0.15.0 | `21af4130b8209ff593dd5b2e6131ffb85a0c68dec81b8bcbf857688519cd27d9` | The default build of commit `a4c7b48` (495,848 bytes, `build.sh --docker`). Added to the OutLayer project on 2026-11-14 (FastFS tx `ADpoV5KwXN5PALj8hG3aeNGsv399P5YFrEy6svmS92kP`, `add_version` tx `DP5ieNgwfqaZU2uPfDBZt6oRMhBSwb3mXhfRVaYeDSMw`). **Active** since 2026-11-14 (`set_active_version` tx `859jnFSeuLjfaDns57EnmA1DVZQJrXC3tV81asdjFS8Z`): a call with no `version_key` runs it. The Seams staging server and the demo route call it. A verdict has the heard words only in a refusal with the reason `words` (see "Signed verdict"). On 2026-11-14, one `verify` call on it gave an `accept` with `"heard":null` (speaker score 822), and one gave a `words` refusal with `"heard":"approve the weekly budget"`. It answers `audio_key` as `0.15.0`. |
| 0.15.0+venice | `5f475dd26794bc09b1f1e157276a19800a4ed3f8df1184c004c49de54e3ffcdf` | The `venice` build of commit `a4c7b48` (400,341 bytes, `build.sh --venice --docker`). Added on 2026-11-14 (FastFS tx `GFMLppbgBrJGPXtEpD4veLZBHxFSwjaF9zFeBQL2WrxT`, `add_version` tx `HLbQGpe93sGmZaSSrKoezSFTD2pqYCZq8BB1ZRTYScvG`). **Not active**: a call reaches it only with `version_key`. On 2026-11-14, one `verify` call on it gave an `accept` with `"heard":null`, and one gave a `words` refusal with the heard words. See "Speech-to-text service". |

The callers use only these two builds. The OutLayer project also holds the
two builds of 0.14.1 (`1e7c6968…8a5c` and `344b8b47…d3c8`), which no caller
uses.

## Build and test

```sh
cargo test           # native tests (fake host), and the shared vectors
./build.sh           # release WASM, size and SHA-256; fails at 1,000,000 bytes
./build.sh --docker  # the same build in the pinned x86_64 Linux image
```

`build.sh` honors `CARGO_TARGET_DIR`. `rust-toolchain.toml` pins Rust 1.97.1
with the `wasm32-wasip2` target. rustup installs it on the first call.

After the Rust build, `build.sh` runs `wasm-opt -Oz` (binaryen 133) on the
core module and makes the component with `wasm-tools component new`
(wasm-tools 1.263.0). The worker is then about 18 % smaller. OutLayer loads
the WASM on each call, and the load time grows with its size (see "Size and
load time"). `./build.sh --docker` downloads the two tools from their GitHub
releases into `target/tools/` and checks their SHA-256. `./build.sh` needs
the same versions of `wasm-opt` and `wasm-tools` on the `PATH`, and writes
`target/worker/seams-voice-verifier.wasm`.

## Reproducible build

The OutLayer version key is the SHA-256 of the WASM. So you can check that a
version comes from this source: build it and compare the hash.

One commit gives the same bytes in any folder and on any machine of the same
host platform. The reference platform is x86_64 Linux
(`x86_64-unknown-linux-gnu`). On such a machine, run this from the root of
the clone:

```sh
crates/voice-verifier/build.sh
```

On any machine with Docker, run this. On a Mac with Apple silicon, Docker
runs the x86_64 image under emulation. After the image download, the build
takes about 40 s.

```sh
crates/voice-verifier/build.sh --docker
```

Expected for the source of version 0.15.0 (commit `a4c7b48`; the later
commits change only documents), on 2026-11-14:

```text
host   x86_64-unknown-linux-gnu
bytes  495848
sha256 21af4130b8209ff593dd5b2e6131ffb85a0c68dec81b8bcbf857688519cd27d9
```

A change to the source of this crate or of `spoken-intent`, to
`../Cargo.lock` or to `build.sh` gives another hash. Deploy the WASM of
`./build.sh --docker`, so that its version key can be built again.

These things make the bytes the same:

- `rust-toolchain.toml` pins the compiler. `../Cargo.lock` pins the crates.
- `../Cargo.toml` is the workspace root. Cargo hashes the path of each path
  dependency into the symbol names: a path below the workspace root as a
  relative path, any other path as an absolute one. With this root,
  `../spoken-intent` is a relative path.
- `build.sh` remaps the local folders that rustc writes into panic locations:
  the clone to `/speak-to-sign`, `CARGO_HOME` to `/cargo`, and the rust-src of
  the toolchain to `/rustc/<commit>`. It replaces any `RUSTFLAGS`.
- `build.sh` pins the versions of `wasm-opt` and `wasm-tools`, and for
  `--docker` the SHA-256 of each download (builds from 2026-11-13).

The host platform changes the bytes. The Cargo hash of each crate that uses a
build script or a procedural macro (for example `serde` and `sha2`) is
different on each host platform. So macOS on arm64 gives
`79ca912f376f4859ff77cc7152c3cd7be391c32db18d56ec3746e70f7e7f1fea`, and Linux
on arm64 gives another hash. A Cargo config with `[profile.release]`
settings, for example in `~/.cargo/config.toml`, also changes the bytes.

Checks on 2026-11-10, each from a fresh clone:

| Build                                                                                     | Host                       | SHA-256     |
| ----------------------------------------------------------------------------------------- | -------------------------- | ----------- |
| `build.sh` in two clones on macOS 15.7.1: one with rust-src, one in a folder with a space | `aarch64-apple-darwin`     | `79ca912f…` |
| `build.sh --docker` from the same two clones                                              | `x86_64-unknown-linux-gnu` | `cdb46fea…` |
| `build.sh` with a fresh rustup and rust-src, another `CARGO_HOME`, a folder with a space  | `x86_64-unknown-linux-gnu` | `cdb46fea…` |

## Size and load time

OutLayer loads the compiled WASM on each call: it reads the file, checks its
hash and its signature, and deserializes it. No loaded module stays in
memory (`worker/src/compiled_cache.rs` of OutLayer). So the size of the WASM
is time on each call.

Measured on OutLayer testnet on 2026-11-12, with an input that does no work
(`{"op":"none"}`) and five builds from 373,865 to 1,038,333 bytes: the
median `time_ms` went from 1,169 to 2,723. That is about 2.3 ms for each KB.
The value changes with the day (about 1 ms for each KB on 2026-11-11), so
compare two builds only in the same run.

So the worker is small (495,848 bytes, `./build.sh --docker`). These steps
made it small, for the source with the NEAR AI check:

| Step                                                         | WASM bytes |
| ------------------------------------------------------------ | ---------- |
| A first build with dcap-qvl                                  | 1,038,333  |
| `wasm-opt -Oz` in `build.sh`                                 | 851,975    |
| The worker's own TDX quote check in place of dcap-qvl        | 560,034    |
| The inputs and two model replies read by hand, without serde | 494,339    |

## Services

- Speaker: ReDimNet B1 in a Phala dstack CVM (`config::SPEAKER_HOST`). Each
  embedding is signed; the worker checks the signature, the nonce, the audio
  digest, the model digest and the pinned key `config::SPEAKER_PINNED_KEY_HEX`.
- Words: Whisper large-v3 on NEAR AI Cloud. Secret `NEAR_AI_API_KEY`. The whole request (with the key) goes sealed with
  Oblivious HTTP to the NEAR AI gateway that the worker checked, and the
  worker reads the attestation report of NEAR AI and Intel's collateral when
  its stored check is older than 6 hours. See "NEAR AI attestation".
- Note summary: JEV (`typesafe/jev-1.13`, Typesafe System
  One) on NEAR AI Cloud (`config::NEAR_AI_SYSTEMONE_URL`), with the same
  secret. Only a `community_note` request calls it.
- NEAR RPC: `https://test.rpc.fastnear.com` (`config::NEAR_RPC_URL`), for the
  owner's access key at enrollment only.
- `verify` sends all its requests at once (`wasi:http`, one poll loop).

## Two variants

One source gives two workers. The verdict, the inputs, the template record
and the storage keys are the same. So a voice that one variant enrolled
passes in the other, if both use the same storage cell (the same project and
payment key).

| | Default | `local-speaker` |
| --- | --- | --- |
| Build | `./build.sh` | `./build.sh --local-speaker` |
| Speaker model | In the speaker service (Phala), signed embeddings | Inside the worker, in `tract` (`src/local_model.rs`) |
| Manifest | `manifest/outlayer.json` | `manifest/outlayer-local-speaker.json` |
| Hosts | Phala, NEAR AI, NEAR RPC, Intel PCS | FastFS (first run only), NEAR AI, NEAR RPC, Intel PCS |
| WASM (macOS arm64 build) | about 0.45 MB | about 8.3 MB |
| Trust for the speaker | The Phala app and its pinned key | Only the worker and the pinned model digest |
| Cost | A second service to operate and pay | More worker time for each call |

How the `local-speaker` variant works:

- The model is 8,859,593 bytes, and OutLayer refuses a WASM of 10 MB or
  more. So the model is not in the WASM.
- The worker keeps the model in its OutLayer storage (`src/model_cache.rs`):
  9 plaintext records of at most 1 MiB in the worker storage of the project,
  with the keys `model:v1:<sha256>:<index>`. A run reads them and downloads
  nothing.
- If the storage does not hold the whole model, the worker downloads the
  file from FastFS (`config::REDIMNET_URL`, host `test.fastfs.io`) and
  writes the records for the next run. So the first run downloads, and the
  later runs do not. A failed write does not fail the run.
- Every run checks the SHA-256 of the bytes against
  `config::SPEAKER_MODEL.sha256_hex`, from the storage and from a download.
  Other bytes count as "not stored". So neither the storage nor the host of
  the file is trusted.
- The device of the user downloads nothing in either variant. Only the
  worker reads the model.
- `verify` sends only the NEAR AI request. After the storage calls, it runs
  the model while that request is in flight (`Host::embed_local`). `enroll`
  runs the model three times while the access-key request is in flight.
- A failure of the download or of the model refuses with
  `speaker_unavailable`.
- The stage times have `model_fetch` (the read of the storage, or the
  download), `model_cached` (1 if no download was necessary) and `redimnet`
  (the model runs), and no `speaker`.

The model file on FastFS (uploaded from `seams-v1.testnet` on 2026-11-10,
9 transactions to `outlayer.testnet`, the first is
`HVcxZzvRH2ne3uq4cELgmHEBkhmf96nxM5uiFFztVvbw`):

```sh
curl -s https://test.fastfs.io/seams-v1.testnet/outlayer.testnet/e04dd7a6a1e23fc7b89e47682ea9d0a3946cf7bc59d07922c3db3efc52ae4269.onnx | shasum -a 256
```

To upload a model file again, or another model:

```sh
python3 -I scripts/fastfs_chunks.py redimnet-b1.onnx chunks onnx application/octet-stream
```

Then send each chunk file as the arguments of `__fastdata_fastfs` on
`outlayer.testnet` (`near contract call-function as-transaction ... file-args
chunks/chunk-000.bin`). Each transaction fails with `MethodNotFound` by
design: FastFS reads the arguments.

Measured on OutLayer testnet on 2026-11-11, one run of each operation for
each variant, with a synthetic voice (macOS `say`) and the same sentences:

| | Default | `local-speaker` |
| --- | --- | --- |
| `verify` or `select`: OutLayer `time_ms` | 1.35 to 1.46 s | 10.6 to 12.5 s |
| `verify` or `select`: time at the client | 2.6 to 2.9 s | 12 to 15 s |
| `verify` or `select`: the worker's own `total` | 0.36 to 0.48 s | 2.2 to 2.7 s |
| `verify` or `select`: instructions | 17 to 27 million | 4.4 to 6.5 billion |
| `verify` or `select`: OutLayer `compute_cost` | about 1,020 | 5,400 to 7,500 |
| `enroll` (three clips): OutLayer `time_ms`, cost | 3.3 s, 1,079 | 14.9 s, 22,364 |
| A call that refuses before any work: `time_ms` | 0.8 s | 11.2 s |

So the `local-speaker` variant is about 8 times slower and 5 to 7 times
more expensive for each call. Where its time goes:

- About 9 s is the fixed time of OutLayer for a WASM of 8 MB (`time_ms`
  less the worker's own `total`). The default variant has about 1 s.
- 1.8 to 1.9 s is the read of the model from the storage with its SHA-256
  (`model_fetch`, with `model_cached` 1).
- 0.3 to 0.7 s is the model run for one clip (`redimnet`).

A later run (2026-11-11) showed that the read of the model from
the worker storage does not have a stable time. Four enrollments in a row
had `model_fetch` of 1.8 s, 8.0 s, 69.6 s and 4.6 s, each with
`model_cached` 1 and about 18.9 billion instructions. In the same hour,
three of twelve `local-speaker` calls failed with the status `failed`; the
probable cause is the time limit of the run (`max_execution_seconds`, 90 in
that test), not the code. The default variant had no such failure. So do not
plan on the 12 s of the table above for each call.

Other facts of that run:

- The worker storage accepts records of 1 MiB. After the first run, each
  run had `model_cached` 1.
- OutLayer stops a call at about 8.9 billion instructions unless the caller
  sends the header `X-Compute-Limit`. The stopped run fails with a trap and
  no reason. An enrollment of this variant needs about 20 billion.
- A template of one variant passed in the other: both use one storage cell.
- Not measured: the time of the first run, which downloads the model; and
  if the worker storage is one for the project or one for each caller (the
  runs had one caller).

Both variants declare the same signing key (`verdict`, `bind: "project"`).
As two versions of one project, they sign with the same key. A verdict does
not show which variant made it.

Tests: `cargo test` covers both paths with the fake host
(`tests/ops/local_speaker.rs`). With the model file, this runs the real
model natively:

```sh
SEAMS_REDIMNET_PATH=/path/to/redimnet-b1.onnx cargo test --release --features local-speaker --lib local_model
```

## Speech-to-text service

The build picks the service that hears the words (`src/transcriber.rs`,
`PROVIDER`). One build has one service, and it is part of the code that the
WASM hash names. `src/ops/whisper.rs` is the only step that knows which
service it is.

| | Default | `venice` |
| --- | --- | --- |
| Build | `./build.sh --docker` | `./build.sh --venice --docker` |
| Service | NEAR AI Cloud, `openai/whisper-large-v3` | Venice AI, `fal-ai/wizper` (Whisper large-v3) |
| Transport | Oblivious HTTP, sealed to the gateway that the worker checked (see "NEAR AI attestation") | Plain HTTPS |
| Check of the service | The TDX quotes of the gateway and of the model. No checked gateway, no request. | None. Venice gives no TEE quote. |
| Who can read the audio | The worker and the NEAR AI TDX VMs | The worker and Venice AI |
| Version in each signed output | `0.15.0` | `0.15.0+venice` |
| OutLayer secret | `NEAR_AI_API_KEY` | `VENICE_API_KEY`, and `NEAR_AI_API_KEY` for a note and for `detect` |
| Manifest | `manifest/outlayer.json` | `manifest/outlayer-venice.json`: `api.venice.ai` in place of the two Intel hosts |
| Worker (`--docker`, this commit) | 495,848 bytes | 400,341 bytes: the gateway check is not in it |

The `venice` build is the fallback for an outage of NEAR AI Whisper. On
2026-11-12 Whisper gave no reply for more than an hour, while the rest of
NEAR AI answered, and each voice check failed with `transcriber_unavailable`.
Venice AI answered the same 5 s clip in 1.5 s.

Facts of the `venice` build:

- **Venice is not attested.** Its terms say that it keeps no data, but
  nothing here checks that. While a caller selects this build, a party
  outside a TEE reads each recording. Do not say that only TEEs open the
  audio for a verdict that ends in `+venice`.
- **The verdict says so.** The field `verifier` of each verdict, transcript
  and intent is `0.15.0+venice`, and the TDX quote of the call names the
  WASM hash of this build. The verdict key is the same (it is bound to the
  project), so a contract or a Wallet that pins only the key accepts it. A
  checker that must refuse Venice reads `verifier`.
- **The caller selects it** with the `version_key` of its WASM. To go back
  to NEAR AI, the caller sets the `version_key` of the default build again.
  No input field selects the service: a page cannot move the audio.
- **Only Whisper moves.** The summary check of a note (JEV) and the chat
  model of `detect` stay on NEAR AI. A note with no `NEAR_AI_API_KEY`
  refuses with `summary_check_unavailable`.
- The request has the same form: `model`, `language` and `file`, with no
  prompt. The file part is `audio/x-wav`: Venice answers 422 for
  `audio/wav`. Venice adds `duration` to its reply; the worker reads only `text`.
- `local-speaker` and `venice` together do not compile.
- The shared vectors are those of the default build. `cargo test --features
  venice` skips them and the tests of the gateway check, and runs the others
  against a fake Venice.

To add another service: add its `Provider` constant in `src/transcriber.rs`,
its constants in `src/config.rs`, a feature, a manifest, and one line in
`build.sh`.

## Another speaker model

`config::SPEAKER_MODEL` holds every value that changes with the model: the
SHA-256 of the ONNX file, its URL and size, the embedding size, the cutoff
and the name of the output node. Today it is `REDIMNET_B1`.

To use another model (for example another ReDimNet size):

1. Measure the cutoff of the model on real recordings. Do not copy 0.45.
2. Add a `SpeakerModel` constant in `src/config.rs` and set `SPEAKER_MODEL`
   to it.
3. For the default variant, build the speaker service with the same file
   (`MODEL_SHA256` and `EMBEDDING_DIM` in `crates/speaker-service/src/lib.rs`)
   and pin its new key.
4. For the `local-speaker` variant, upload the file to FastFS (see "Two
   variants") and set its URL. The storage keys name the digest, so the new
   model has its own records. Check that `tract` loads
   the model: ReDimNet B1 needs the typed plan with no declutter pass.
5. Build. The WASM hash changes.

A template records the digest of its model. A worker with another model does
not read it and refuses with `template_missing`, so each owner enrolls
again. One build has one model: the model is part of the code that a WASM
hash names.

## Overlap of network and storage

The OutLayer storage functions are blocking host calls. So each operation
starts its HTTPS requests and sends their bodies first (`Host::post_start`),
then makes its storage calls, then polls the responses (`Host::post_wait`).
The host carries the requests during the storage calls. A storage refusal
(`template_missing`, `audio_reused`, `storage`) drops the requests
(`Host::post_cancel`); a reused recording can thus cost one NEAR AI call.

An operation with words needs one storage read before its Whisper request:
the record of the checked NEAR AI gateway (see "NEAR AI attestation"). The
speaker request needs no checked gateway. So it starts first, the read runs
while it is in flight, and the Whisper request and the summary check then
join the same batch (`Host::post_add`). On 2026-11-12 the read took 63 and
189 ms (`tee`), and the speaker reply 789 to 1,445 ms for a clip of 1.5 s.
So the read costs time only if the Whisper reply is the last one. No audio
goes to NEAR AI before the gateway is checked. `post_add` did not yet run
on OutLayer.

`verify` reads the template, then writes the used-audio mark with one atomic
set-if-absent, while the requests are in flight. So the
mark is off the critical path, and a reused recording is refused by the same
write. A refusal or a service outage after the mark also uses up the
recording; the Wallet records new audio for each try. An owner without a
template uses up nothing. Between the two storage calls, `Host::post_poll`
takes the responses that are ready, so their times do not include the mark.

Stage times (`ms`, not signed), in ms:

| Field        | `verify` | `enroll` | Meaning                                                            |
| ------------ | -------- | -------- | ------------------------------------------------------------------ |
| `decode`     | yes      |          | input, request digests, WAV decode, energy gate                    |
| `send`       | yes      | yes      | start the requests and send the bodies                             |
| `storage`    | yes      | yes      | `verify`: template read and used-audio mark, during the requests   |
| `wait`       | yes      | yes      | the rest of the network time after the storage calls               |
| `parallel`   | yes      | yes      | start of the requests to the last response (send + storage + wait) |
| `speaker`    | yes      | yes      | speaker service response (`enroll`: the slowest of three)          |
| `transcribe` | yes      |          | NEAR AI response (at most the template read late)                  |
| `tee`        | yes      |          | Get the checked NEAR AI gateway, while the speaker request is in flight |
| `tee_cached` | yes      |          | 1: the stored check; 0: a new check; 2: the stored check, because the new one could not reach a service |
| `summary`    | yes      |          | JEV response, a community note only             |
| `redimnet`   | yes      |          | the service's own model time                                       |
| `rpc`        |          | yes      | NEAR RPC access-key view response                                  |
| `mark`       | yes      |          | used-audio write, inside `storage`                                 |
| `policy`     | yes      |          | the policy step                                                    |
| `write`      |          | yes      | used-audio writes and the template write                           |
| `sign`       | yes      |          | verdict signature                                                  |
| `total`      | yes      | yes      | the whole operation                                                |

## Inputs

- `audio_key`: `{"op":"audio_key"}`.
- Each recording is a plain WAV in `audio_wav_b64`, as below, or a sealed one in `audio_sealed_b64` (see "Sealed audio").
- `enroll`: `{"op":"enroll","owner","audio_wav_b64":[3 WAVs],"authorization":{"public_key","signature_b64","nonce_b64"}}`.
- `verify`: `{"op":"verify","owner","request":{"kind":"transfer","receiver","amount_yocto"},"contacts":[...],"audio_wav_b64"}`.
  - `request` is tagged by `kind`:
    - `transfer`: a native NEAR transfer from `owner` to `receiver`, as
      `spoken_intent::SpokenRequestV1::AccountTransfer`. The receiver must be
      a named account that the text can say, and not the owner.
    - `community_note`:
      `{"contract","post_id","note_text","summary"}`, as
      `SpokenRequestV1::CommunityNote`. The owner says only the summary:
      1 to 12 words of ASCII letters (`spoken_intent::SpokenSummary`). The
      note is bound by the SHA-256 of `note_text` (1 to 280 characters, not
      only white space), which the verifier calculates.
    - `note_rating`: `{"contract","note_id","rating"}` with
      `rating` `helpful`, `somewhat_helpful` or `not_helpful`, as
      `SpokenRequestV1::NoteRating`. The owner says "this note is helpful",
      "this note is somewhat helpful" or "this note is not helpful".
    - `merge_approval`:
      `{"contract","repo_sha256_hex","pull_request","base","head_commit_hex"}`,
      as `SpokenRequestV1::MergeApproval`. The owner says "merge pull request
      <number> into <base>", for example "merge pull request forty two into
      main". `pull_request` is 1 or more. `base` is 1 to 32 ASCII lowercase
      letters (`spoken_intent::SpokenBranch`). The repository is bound by the
      SHA-256 of its name (64 lowercase hex characters) and the head commit
      by its 20-byte id (40 lowercase hex characters). It moves no value: the
      Wallet calls only `approve_merge`, with no deposit. Any other value
      refuses with `unsupported`.
    - `multisig_propose`:
      `{"multisig","proposal_id","receiver","amount_yocto"}`. The proposer
      says "approve proposal <id>, send <amount> NEAR to <receiver>". The
      worker draws a 32-byte salt and builds
      `SpokenRequestV1::MultisigApproval`. Its request digest binds the
      salted commitment, not the proposal (`spoken_intent::multisig_approval_digest`).
      On an accept the worker stores the proposal and the salt, and the
      output has `"multisig":{"commitment","salt"}` (base64url) and no stage
      times, so that it stays below 1,024 bytes.
    - `multisig_hide_note`:
      `{"multisig","proposal_id","note_id"}`, with `note_id` 1 or more. The
      proposer says "approve proposal <id>, hide note <note id>" with the
      exact words. Like `multisig_propose`, the worker draws the salt,
      stores the proposal (`{"proposal_id","note_id","salt_hex"}`) and
      returns the commitment and the salt. The near misses are the note id
      one lower, one higher, and with each digit changed.
    - `multisig_confirm`:
      `{"multisig","proposal_id","commitment_hex"}`. Another member says the
      same sentence from memory: the input does not hold the proposal. The
      worker loads it by the commitment and refuses `proposal_missing` if it
      has none under that id. The verdict of a refusal has no
      `spoken_text_digest` and no `word_margin_milli`, and no output of a
      confirmation holds the salt. Three `words` refusals of one member for
      one proposal give `attempts_exhausted`; only refusals after the
      speaker check passed count. A voice that passes against another
      member who already said the proposal refuses `same_speaker`.
    - `confirmation`: `{"context","payload_sha256_hex","summary"}`, as
      `SpokenRequestV1::Confirmation` (tag 10). It is for an application
      that is not a NEAR application: a login, an order, a transaction of
      another chain. The owner must be an application owner (`app:<id>`),
      and an application owner can use only this kind. The owner says the
      summary. The verdict binds the owner, the context (1 to 64 characters
      of `a-z`, `0-9`, `.`, `_`, `-`, `:`, `/`) and the SHA-256 of the
      payload. The application defines the payload bytes.
    - Numbers in a summary (all summary kinds):
      write the number in words ("Pay forty dollars for two books"). The
      model can write it as a numeral, and the worker reads "40", "$40" and
      "40 dollars" as the same words. It reads `$`, the euro sign and the
      pound sign before a whole number, and `%` after a number. An amount
      with a decimal point ("$2.50") has no single spoken form: do not put
      one in a summary.
    - The contract `demo/contracts/voice-multisig` checks each verdict of
      these kinds on chain. `Transfer` and `HideNote` proposals exist.
  - The words must match the rendered text of the request. A rating and a
    merge approval need the exact words. Two kinds of forgiveness exist;
    each applies to words that hold no value:
    - Send sentence: the
      first word "sent" or "sends" counts as "send"; a closed list of
      sound-alikes of "near" and of "testnet" counts as the word itself; a
      number sound-alike counts as the number word in the amount slot; and a
      receiver one sound from a known account (the receiver or a contact)
      counts as that account. The amount and the receiver are still compared
      with the request. Negations, other units and added clauses are refused.
    - Multisig proposal of a transfer: in "approve
      proposal <number> send …", the send part gets the same forgiveness. So
      "seams grants point testnet" and "seams dash grants dot testnet" both
      count as `seams-grants.testnet`. A confirmation (`multisig_confirm`)
      adds no receiver to the known accounts: a match by sound would write
      the hidden receiver into `heard`. Its send part gets only the verb,
      amount and unit rules.
    - Community note summary: a summary of 4 or more words
      also passes with one word changed or dropped, when the heard words are
      still closer to the summary than to every near miss (an added or dropped
      "not" never passes). The changed or dropped word is never
      a number word: "pay fourteen dollars" does not pass for "pay forty
      dollars".
  - `contacts`: at most 32 named accounts that the owner knows, for the
    account names and the confusion set. The receiver is added if missing,
    except for `multisig_confirm`.
- `select`: `{"op":"select","owner","requests":[2 to 16 requests],"contacts":[...],"audio_wav_b64"}`.
  - The verdict is for the one request whose sentence the owner said. The
    output is the output of `verify`, with `"selected"`: the index of that
    request (not signed; the verdict binds its request digest).
  - The heard words must equal the sentence of exactly one candidate. No
    summary passes with a changed word, because the other candidates are
    the near misses. No match refuses with `words`; two matches refuse with
    `words` and the detail `select: ambiguous`.
  - Two candidates with one sentence, fewer than 2 or more than 16
    candidates, or a multisig kind refuse with `unsupported`.
  - The policy step runs for the selected request.
- `transcribe`: `{"op":"transcribe","owner","audio_wav_b64"}`. No request.
  - The output is
    `{"kind":"seams_voice_transcript_output_v1","transcript_json","signature_b64","public_key","ms","detail"}`.
  - `transcript_json` is the only signed object: compact JSON with 9
    fields, in this order: `kind` (`seams_voice_signed_transcript_v1`),
    `verifier`, `owner`, `audio_digest`, `outcome` (`accept` or `refuse`),
    `reason`, `expires_at_ms`, `speaker_score_milli`, `text`.
  - `text` is the heard words: lowercase ASCII letters, digits and
    apostrophes with single spaces, cut to 200 bytes. It is set only on
    `accept`.
  - The signed message is
    `SHA-256("seams:outlayer:voice-transcript:v1" || transcript_json bytes)`,
    by the same key as a verdict. The prefix and the kind are not those of a
    verdict, so no checker of verdicts accepts a transcript.
  - The speaker check, the energy gate and the used-audio mark are those of
    `verify`. No words refuse with `words`.
  - The model writes numbers in different ways. In two runs of one sentence
    it gave "8" and "eight".
  - A transcript is weaker than a verdict. No sentence is expected, so the
    worker makes no word check and no near-miss check. NEAR AI gives the
    text with no signature. Do not let a transcript approve an action with
    value.
  - Shared vectors: `testdata/signed_transcript_v1.json`
    (`tests/signed_transcript_vector.rs`).
- `detect`:
  `{"op":"detect","owner","intents":[1 to 16 intents],"audio_wav_b64"}`.
  - An intent is `{"name","description","slots":{"<slot>":"text"|"number"}}`.
    A name is 1 to 32 characters of `a-z`, `0-9` and `_`. A description is
    1 to 120 ASCII letters, digits, spaces and `. , ' -`. An intent has at
    most 6 slots.
  - The worker checks the speaker and gets the heard words, as `transcribe`
    does. Then it sends the words and the list to a chat model on NEAR AI
    (`config::NEAR_AI_CHAT_MODEL`, `Qwen/Qwen3.8-27B`). A voice that does
    not pass gets no model call.
  - The output is
    `{"kind":"seams_voice_intent_output_v1","intent_json","signature_b64","public_key","ms","detail"}`.
  - `intent_json` is the only signed object: 13 fields, in this order:
    `kind` (`seams_voice_signed_intent_v1`), `verifier`, `owner`,
    `audio_digest`, `intents_digest`, `outcome`, `reason`, `expires_at_ms`,
    `speaker_score_milli`, `text` (cut to 80 bytes), `model`, `intent`,
    `slots`.
  - `intents_digest` is base64url
    `SHA-256("seams:voice-intent:intents:v1" || canonical JSON of the list)`.
    The canonical JSON is compact, each intent as `name`, `description`,
    `slots`, with the slots in name order.
  - The signed message is
    `SHA-256("seams:outlayer:voice-intent:v1" || intent_json bytes)`.
  - The worker checks the form of the model's reply: the intent is a name of
    the list or `null`; each slot is a slot of that intent; a text value has
    only heard words and at most 40 bytes; a number value is a JSON number.
    Any other value becomes `null`. An unknown intent or slot refuses with
    `detector_unavailable`.
  - An accept with `"intent":null` means: the model named no intent.
  - This is the weakest operation. Two models make the result, and neither
    signs its part. The result is a proposal: show the action, then confirm
    it with `verify` or `select`.
  - The chat model took about 11 s for each of 5 calls from a desktop
    computer (`tests/detect_live.rs`). On OutLayer testnet, a whole `detect`
    call of the default variant took 6 to 10 s at the client. Give the call
    a `max_execution_seconds` of 40 or more.
  - Shared vectors: `testdata/signed_intent_v1.json`
    (`tests/signed_intent_vector.rs`).
- Unknown fields are refused at every level.
- WAV: 16 kHz mono PCM16, at most 8 s, standard base64. The worker writes it
  again with a 44-byte header (the canonical WAV); the audio digest is the
  SHA-256 of the canonical WAV.

## Note summary check

The owner of a community note says a summary of
the note, not the note. The word check shows that the voice said the
summary. The summary check shows that the summary gives the main point of
the note. So an app cannot show one note and sign another note.

- `verify` sends the note text and the summary to JEV with the speaker and
  the transcription requests. JEV answers one `noul` question (`fits`) with a
  probability. The instructions say that the note and the summary are
  untrusted data (`summary_check::INSTRUCTIONS`).
- The check runs after the word check. A transcript that fails the words
  refuses with `words`, whatever JEV said.
- A fit of 600 thousandths or more passes (`config::SUMMARY_FIT_MILLI`).
  Below it, `summary_mismatch`, with the detail `summary: fit_<milli>`.
- No answer, or a reply with no fit, refuses with
  `summary_check_unavailable` (detail `summary: status_<code>` or
  `summary: bad_reply`).
- A `note_rating` has no summary, so it has no summary check.

Calibration with the instructions of this build: fair summaries gave 680 to
940; a summary of another note or the opposite claim gave 480 or less;
generic summaries ("this is a note about a post") gave 410 to 690. JEV
answers in approximately 0.3 s, in parallel with the transcription.

### Who writes the summary

The Seams server writes the summary from the note text, and the application
gives none. So an application cannot choose the words that the owner says.

- The writer is `Qwen/Qwen3.8-27B` on NEAR AI, with thinking off
  (`chat_template_kwargs: { enable_thinking: false }`). With thinking on, the
  model is slow and often gives no text. One summary takes 0.5 to 1.0 s.
- JEV only answers questions and cannot write text. So Qwen writes, and JEV
  checks.
- The verifier gets the note text, not only its hash. It calculates
  `note_sha256` itself, so the hash in the signed request is the hash of the
  text that JEV read.
- A summary cannot start with "send", "sent" or "sends". The word rules read
  such a sentence as a payment: they change "to" to "two" and add "near"
  after an amount. The Seams server checks each summary against the rules of
  `SpokenSummary` and asks the model again if a rule fails. The owner of the
  note never sees this rule.

## NEAR AI attestation

The worker sends each recording to Whisper only
sealed to the NEAR AI gateway, and only after it checked the gateway's
attestation. Older versions send it over HTTPS and check nothing about
NEAR AI.

The request (`src/transcriber.rs`, `src/ohttp.rs`):

- The worker writes the transcription request as Binary HTTP (RFC 9292,
  known-length form): the POST to `/v1/audio/transcriptions` with the API
  key, the multipart body and `x-no-aliasing: true`.
- It seals the whole message with Oblivious HTTP (RFC 9458): HPKE base mode
  with DHKEM(X25519, HKDF-SHA256), HKDF-SHA256 and ChaCha20-Poly1305, to the
  OHTTP key configuration of the checked gateway. The POST goes to
  `https://cloud-api.near.ai/ohttp` with the content type
  `message/ohttp-req`. TLS terminators and the host of the VM carry only
  ciphertext.
- The gateway opens the request inside its TDX VM, and sends it to its own
  route on the loopback address (source: `crates/api/src/routes/ohttp.rs` of
  `nearai/cloud-api`). It seals the reply with a key from the same HPKE
  context. So a reply that opens was written by the holder of the gateway
  key, for this request.

The check (`src/nearai_attestation.rs`): `GET
https://cloud-api.near.ai/v1/attestation/report?model=openai/whisper-large-v3&signing_algo=ed25519&nonce=<32 random bytes>`
(no API key), then Intel's collateral of its two quotes from Intel PCS: the
PCK CRL, the TCB info of each FMSPC, the QE identity and the root CA CRL. The
check passes only if:

1. The gateway's TDX quote chains to Intel's SGX root CA with that
   collateral at the worker's time (`src/tdx_quote.rs`, see "The TDX quote
   check"), the TCB status is
   `UpToDate` or `SWHardeningNeeded`, and the TD is not a debug TD. Both
   quotes were `UpToDate` on 2026-11-12.
2. The report data of the quote is the gateway's ed25519 key, then the nonce
   of this check. The key is the pinned `config::NEAR_AI_GATEWAY_KEY_HEX`
   (`40599fb2…4acb`). The gateway derives it from its dstack KMS key, so
   every gateway instance has it (three instances gave it on 2026-11-12).
3. The MRCONFIGID of the quote is `0x01 || SHA-256(app_compose) || 15 zero
   bytes` (dstack). So the compose file of the report is the one that the TD
   runs. The worker records its hash and does not pin it: NEAR AI deploys
   often.
4. The gateway key signs (ed25519) the OHTTP key configuration, and the
   configuration has an X25519 key and the suite HKDF-SHA256 with
   ChaCha20-Poly1305.
5. The report has an attestation of `openai/whisper-large-v3`. Its TDX
   quote passes the checks of step 1 and binds the model's ed25519 key and
   the same nonce.

The cache (`src/ops/whisper.rs`). A check that passes is a plaintext record
in the worker storage of the project, `nearai-gateway:v1`: the gateway key,
the OHTTP key configuration, the compose hash, the TCB status, the SHA-256
of the quote and the time of the check. All callers and all versions of the
project share it. Each operation with words (`verify`, `select`,
`transcribe`, `detect`) does this before it sends a request to NEAR AI. The
speaker request is in flight during these steps:

- It reads the record. If the check is younger than 6 hours
  (`config::NEAR_AI_ATTESTATION_TTL_MS`), it seals to the key configuration
  of the record. This is the normal call: one storage read, and about 3 ms
  to seal a WAV of 211 KB (native release build).
- Else it checks again with a fresh nonce, and writes the new record.
- If that check cannot reach NEAR AI or Intel PCS, it uses the stored check
  up to 24 hours after that check (`config::NEAR_AI_ATTESTATION_GRACE_MS`).
  After that, it refuses with `transcriber_unavailable`.
- If an answer fails a check, it refuses with `transcriber_not_attested`, also
  within the 24 hours. No request goes to NEAR AI, and the speaker request is
  dropped.
- A reply that does not open, or the status 400 of the OHTTP endpoint (the
  gateway could not open the request, for example after a change of its
  key), refuses with `transcriber_not_attested` and drops the record. The
  next call checks again.

Times on 2026-11-12, from a laptop, not from OutLayer:

| Step | Time |
| --- | --- |
| A sealed transcription of a 211 KB WAV (4 calls) | 1.35 to 1.52 s |
| The same request in plain HTTPS (4 calls) | 1.50 to 1.57 s |
| The attestation report (288,651 bytes) | 1.41 to 1.51 s |
| Intel's collateral, five requests in parallel | 0.87 to 0.93 s |
| The two quote checks (native release build) | 6 to 9 ms |

So a normal call adds the storage read and the seal, and the first call after
6 hours adds about 2.4 s. Not checked:

- The code that NEAR AI's VMs run. The worker records the compose hash of the
  gateway, not a review of it.
- How the gateway reaches Whisper. The gateway's code checks Whisper's TDX
  and GPU attestation and pins Whisper's TLS key
  (`crates/inference_providers/src/spki_verifier.rs` of `nearai/cloud-api`).
- The NVIDIA GPU evidence in the report of the Whisper VM.
- That the gateway passes Whisper's words unchanged. NEAR AI does not sign a
  transcription: its signature endpoint covers chat completions and
  responses only.

Tests: `tests/nearai_attestation.rs` checks a recorded real report
(`testdata/nearai_report_v1.json`, for the nonce of 32 bytes of 0x5a) with
Intel's recorded replies (`testdata/nearai_collateral_v1.json`) at the time of
the recording: a wrong nonce, stale collateral, another compose file, a
changed MRCONFIGID, another model, other keys, changed signatures and
collateral, and no answer. `tests/ops/whisper.rs` tests the cache and each
refusal with a fake gateway. Against the live services:

```sh
SEAMS_NEAR_AI_LIVE=1 cargo test --release --test nearai_attestation_live -- --nocapture
SEAMS_NEAR_AI_LIVE=1 NEAR_AI_API_KEY=... SEAMS_WAV=clip.wav cargo test --release --test ohttp_live -- --nocapture
# New test data (no API key):
SEAMS_NEAR_AI_RECORD=1 cargo test --release --test nearai_attestation_live
```

### The TDX quote check

The worker has its own small check of a TDX quote: `src/tdx_quote.rs`, with
Intel's certificates and CRLs in `src/x509.rs`. Its only new dependency is
`p256` (ECDSA). It replaced `dcap-qvl` with `webpki` and `x509-cert`. The
reference build of this source (`build.sh --docker`) is 560,034 bytes, against
851,975 with `dcap-qvl`.

It checks a quote of version 4 with a TD 1.0 report, which is what NEAR AI
gives. It refuses SGX quotes, quotes of version 5, TD 1.5 reports and a quote
without its PCK certificate chain. The checks are the ones of `dcap-qvl`
0.7.1 for such a quote:

1. Intel's root CA certificate is pinned (`src/intel_sgx_root_ca.der`). The
   root CA CRL has its signature.
2. The TCB info and the QE identity: the root issued their signer, the signer
   signed the exact JSON text, and the worker's time is between `issueDate`
   and `nextUpdate`.
3. The PCK certificate chain of the quote: the root issued the PCK CA, the PCK
   CA issued the PCK certificate, and no CRL lists them.
4. The PCK key signed the QE report, the QE report binds the attestation key,
   and the QE report fits the QE identity.
5. The attestation key signed the quote header and the TD report.
6. The TCB status comes from the TCB level of the platform, of the TDX module
   and of the QE. A revoked TCB fails.
7. The TDX module has the signer and the attributes of the TCB info. The TD is
   not a debug TD, and it has no migration and no service TD.

`src/x509.rs` is not a general X.509 library. Intel's PKI has four kinds of
certificate, each with a P-256 key and an ECDSA signature with SHA-256. For a
certificate and its issuer, the module checks the signature, the issuer name,
the validity and the CRL of the issuer. It does not do name constraints,
policies, key usage, path lengths or CRL extensions, because Intel's PKI does
not use them.

Tests, with the two recorded quotes and Intel's recorded collateral:

- `tests/tdx_quote.rs` gives the same input to the worker and to `dcap-qvl`
  0.7.1, and compares the decisions. The inputs are the recorded ones, about
  3,600 quotes with one changed bit, 2,700 changes of the collateral, the
  first and the last second that pass, and 1,350 changed TCB infos (seven
  different TCB statuses). The worker accepts no input that `dcap-qvl`
  refuses. It is more strict in two places that no signature covers: the type
  field of the certification data, and the text around the certificates of a
  PEM chain.
- The tests in `src/x509.rs` compare each field that the module reads with
  `x509-cert` 0.3.0, on the real certificates and CRLs. They also check a
  revoked serial number, a wrong issuer and the ends of each validity.

## Sealed audio

A Wallet seals each WAV to the audio key, so the
Seams server and OutLayer's coordinator carry only ciphertext
(`src/envelope.rs`; the Wallet side is
`packages/voice-verdict/src/audioEnvelope.ts`, `sealAudio` of
`@seams/voice-verdict`).

- The envelope is HPKE base mode (RFC 9180): DHKEM(X25519, HKDF-SHA256),
  HKDF-SHA256, ChaCha20-Poly1305. `info` is `seams:voice-audio:v1`
  (`config::AUDIO_INFO`). The `aad` is `op || 0x00 || owner`.
- A sealed clip is `enc || ciphertext || tag` in standard base64. `verify`,
  `select`, `transcribe` and `detect` take one in `audio_sealed_b64`;
  `enroll` takes three. The `op` of the `aad` is the operation's own name. An input has
  `audio_wav_b64` or `audio_sealed_b64`, not both.
- The private key is the OutLayer secret `PROTECTED_AUDIO_KEY`
  (`config::AUDIO_KEY_ENV`), 64 hex characters. Create it on the OutLayer
  Secrets page as an auto-generated secret of type `hex32`, in the secrets
  profile of the verify route. The keystore makes it inside its TEE.
- `{"op":"audio_key"}` returns `{"kind":"seams_voice_audio_key_v1",
  "audio_public_key_b64","signature_b64","public_key"}`. The verdict key
  signs `SHA-256(AUDIO_KEY_DOMAIN || audio public key)`.
- The open step is inside the stage `decode`. It adds no network call and no
  storage call.
- Refusals: `audio_invalid` with the detail `not_sealed_to_this_request` for
  a clip that does not open; `unsupported` with the detail
  `audio_key: missing` if the secret is absent or is not 64 hex characters.

The reference build (`build.sh --docker`) of this source is 536,004 bytes.
With AES-256-GCM in place of ChaCha20-Poly1305 it was 549,695 bytes.

The first build of sealed audio, the preview build `e322edae…`, used
AES-256-GCM. A clip that this source or `audioEnvelope.ts` seals does not
open there, and a clip sealed for that build does not open here.

On testnet (2026-11-11, version `bfe81633…`, secrets profile
`cyan-loong.testnet/main`):

- The secret arrives as 64 hex characters.
- The audio public key is `swH9imlBy9lASO9868ouz/FUumuZIK9g/3R7QiFl7ig=`
  (standard base64). The verdict key
  `ed25519:E8E53ydtc9LRvVz9xBCRrSzyBa5nh1gK1ts53Aoo751U` signed it.
- A 3.5 s recording, sealed in Node with `audioEnvelope.ts`, opened in the
  worker and gave the same audio digest as the plain WAV, for `verify` and
  for `transcribe`. The stage `decode` took 22 to 23 ms sealed and 16 to
  17 ms plain (four calls each), so the open step is about 6 ms. The preview
  build with AES-256-GCM took 27 ms sealed.
- A clip sealed for another owner, and a clip sealed for `transcribe` and
  sent to `verify`, refused with `audio_invalid`.
- The test owner has no template, so each call ended with
  `template_missing`. No sealed call ran to an accept.

Do not store a row of this profile again with "Create New Secrets" or
"Replace": that replaces the row and its `NEAR_AI_API_KEY`. Use "Update" in
the mode "Append".

## Policy step

After the speaker and the words pass, `policy::decide` can only tighten the
decision: an accept becomes a `step_up`, and the Wallet then asks for a fresh
passkey as well. A plain-English policy engine plugs in here later. Today one
fixed rule stands in for it:

| Rule id                           | Text                                             |
| --------------------------------- | ------------------------------------------------ |
| `stub_voice_amount_above_10_near` | A voice payment above 10 NEAR needs a passkey.   |

Exactly 10 NEAR is allowed. A step-up still marks the audio used.

## Signed verdict

`verify` returns `{"kind":"seams_voice_verify_output_v2","verdict_json","signature_b64","public_key","policy_text","ms","detail"}`.

- `verdict_json` (a string) is the only signed object: compact JSON with 13
  fields, always all present, in this order: `kind`
  (`seams_voice_signed_verdict_v2`), `renderer` (`spoken-intent/1`),
  `verifier`, `request_digest`, `spoken_text_digest`, `audio_digest`,
  `outcome` (`accept`, `step_up` or `refuse`), `reason` (only on `refuse`),
  `policy_rule` (the rule id, only on `step_up`), `expires_at_ms`,
  `speaker_score_milli`, `word_margin_milli`, `heard`.
- `expires_at_ms`: the worker wall clock read before signing, plus 120 s
  (`config::VERDICT_TTL_MS`), in ms since the UNIX epoch. Every verdict has
  it. The Wallet refuses a verdict after it.
- The signed message is
  `SHA-256("seams:outlayer:voice-verdict:v2" || verdict_json bytes)`, signed
  by the manifest key `verdict` (`bind: "project"`). The keystore derives that
  key from the project and the caller; over HTTPS the caller is the
  payment-key owner, so the Wallet's pinned key holds only for runs that the
  Seams payment key pays for. The key stays the same across versions. The
  testnet key is `ed25519:E8E53ydtc9LRvVz9xBCRrSzyBa5nh1gK1ts53Aoo751U`. Wallet
  core pins it and refuses a verdict of any other key.
- `policy_text` (not signed): the sentence of the rule on `step_up`, else
  `null`.
- The output stays below 1,024 bytes; `heard` of a `words` refusal is cut to
  fit.
- `heard` has the heard words only in a refusal with the reason `words`
 . In an `accept`, a `step_up` and each other refusal it
  is `null`: a verdict that passes goes to a contract as a call argument,
  and the arguments are public on chain. No check reads `heard`
  ([spec 8.2](../../docs/voice-intents-spec.md#82-the-heard-words)).

## Owners

- A NEAR account. `enroll` needs the NEP-413 authorization of the section
  below.
- An application owner: `app:` and then the id that the application gives
  its user, for example `app:user-42`. The id is 1 or more characters of
  `a-z`, `0-9`, `.`, `_`, `-` and `:`; the whole text is at most 100 bytes.
  A NEAR account id cannot hold ":", so the two kinds never collide.
  - `enroll` takes no `authorization` for it:
    `{"op":"enroll","owner":"app:user-42","audio_wav_b64":[3 WAVs]}`. It
    makes no NEAR RPC call.
  - The authority is the caller of the worker: the owner of the OutLayer
    payment key. The storage cell and the verdict key belong to that payment
    key. So a developer with an own payment key has an own set of users and
    an own verdict key. The application is trusted for the identity of its
    users: any holder of the payment key can enroll, or enroll again, any
    application owner of that cell. Keep the payment key on a server.

## Owner-authorized enrollment

The owner signs one NEP-413 message with a full-access key of the owner
account. The Wallet does this with its NEP-413 signing path.

- `enrollment_digest = base64url-no-pad SHA-256("seams:voice-enrollment:v2"
  || owner || 0x00 || d1 || d2 || d3)`, where `d1..d3` are the raw 32-byte
  SHA-256 digests of the three canonical WAVs, in input order.
- NEP-413 payload: `message = "Speak-to-Sign voice enrollment " +
  enrollment_digest`, `recipient = "seams-v1.testnet/voice-verifier"`,
  `nonce` = the 32 bytes of `nonce_b64`, `callback_url = None`.
- `hash = SHA-256(u32 LE 2147484061 || borsh(message, nonce, recipient,
  callback_url))`; the signature is ed25519 over these 32 bytes.

`enroll` computes the digest from the audio it received and checks the
signature before any network call. A bad key, signature or nonce refuses
with `not_authorized` and no network call. Then it reads
`view_access_key(owner, public_key)` (finality `final`) over NEAR RPC in the
same batch as the three speaker calls. A function-call key or an unknown key
refuses with `not_authorized`; an RPC failure with
`authorization_unavailable`. Then no audio is marked used and no template is
written. A re-enrollment with a new authorization replaces the template
(compare-and-swap) and adds 1 to its epoch.

The output is `seams_voice_enrollment_v3`: `owner`, `outcome`, `reason`,
`agreement_milli`, `audio_digests`, `enrollment_digest`, `template_epoch`,
`verifier_public_key`, `ms`, `detail`.

Trust note: the verifier trusts `test.rpc.fastnear.com` for the access-key
view. It does not check a proof of the view result. An RPC operator that lies
can let the holder of any key enroll (or re-enroll) a voice for an owner, or
can block enrollment. Such a template then decides later verdicts.

## Shared vectors

The Wallet's TypeScript tests read these files. Tests in this crate write
them (set `SEAMS_WRITE_VECTOR=1`, or delete a file, and run `cargo test`) and
check that they match what the verifier computes. The test keys are for tests
only.

- `testdata/signed_verdict_v2.json` (`tests/signed_vector.rs`): `domain`,
  `test_seed_hex`, `public_key`, `public_key_hex`, and `verdicts`, a list of
  named cases (`accept` for 2 NEAR, `step_up` for 11 NEAR), each with
  `request` (`kind`, `network`, `owner`, `receiver`, `amount_yocto`),
  `request_borsh_hex`, `spoken_text`, `request_digest`, `spoken_text_digest`,
  `audio_digest`, `outcome`, `policy_rule`, `policy_text`, `expires_at_ms`,
  `verdict_json`, `message_sha256_hex` and `signature_b64`.
- `testdata/sealed_audio_v1.json` (`tests/ops/sealed.rs`): one clip sealed
  with a fixed ephemeral key: `audio_key_secret_hex`, `audio_public_key_hex`,
  `ephemeral_ikm_hex`, `op`, `owner`, `plaintext_hex`, `sealed_hex` and
  `audio_key_message_hex`. `packages/voice-verdict/tests/audioEnvelope.test.ts`
  seals the same clip in TypeScript and gets the same bytes.
- `testdata/enrollment_digest_v2.json` (`tests/enrollment_vectors.rs`):
  `domain`, `owner`, `audio_digests` (base64url), `enrollment_digest`.
- `testdata/enrollment_authorization_v1.json` (`tests/enrollment_vectors.rs`):
  `test_seed_hex` (bytes 1 to 32), `public_key`, `owner`,
  `enrollment_digest`, `message`, `recipient`, `nonce_b64`, `nep413_tag`,
  `nep413_hash_hex`, `signature_b64`.

## Storage (the payment-key owner's cell)

- `template:v3:<owner>`: keystore-encrypted,
  `SVT1 || epoch || ReDimNet SHA-256 || 192 f32 LE`. Replaced only by an
  authorized re-enrollment, which adds 1 to the epoch. The earlier
  `template:v2:<vault>:<owner>` records are not read, so each owner enrolls
  again once.
- `audio:v2:<digest>`: raw used-audio marker.
- `msig1:<multisig>:<commitment b64u>:open`: keystore-encrypted JSON
  `{proposal_id, receiver, amount_yocto, salt_hex}` of a multisig proposal.
- `msig1:<multisig>:<commitment b64u>:voices`: JSON array of the owners whose
  multisig verdict was an accept.
- `msig1:<multisig>:<commitment b64u>:tries:<owner>`: the decimal count of
  `words` refusals of that owner.

The worker storage of the project (one for all callers and versions) holds
`nearai-gateway:v1`, the checked NEAR AI gateway (see "NEAR AI attestation"),
and the model records of the `local-speaker` variant.

## Vendored crate

`vendor/bit-vec` is kept for `voice-probe`, which patches to it.

`vendor/dcap-qvl` is dcap-qvl 0.7.1 with its `src/` unchanged. It is a
dev-dependency only: the reference of `tests/tdx_quote.rs` (see "The TDX quote
check"). The worker does not use it. Its manifest does not turn on
`serde_json/preserve_order` (that feature would change the key order of every
JSON value in the tests of the verifier), builds an `rlib` only, and has no
test targets. Its first lines give the checksum of the crate.
