# seams-voice-verifier

OutLayer worker (`wasm32-wasip2`) for Speak-to-Sign (plan
`seams-wallet/docs/refactor-227-speak-to-sign-without-passkey.md`). The Seams
verify route calls it with
`POST https://testnet-api.outlayer.ai/call/seams-v1.testnet/voice-verifier`.
Operations: `enroll` and `verify`. The default worker has no `tract` and no
ReDimNet: the speaker model runs in a service on Phala. The variant
`local-speaker` runs ReDimNet inside the worker (see "Two variants").

The verdict authorizes a payment from the owner's own account: the Wallet
checks it against the key that it pins and signs the transaction itself.
There is no vault contract.

## Versions

The source on this branch is version 0.10.0 (`config::VERIFIER_VERSION`). The
sections below say when a feature needs a later version than 0.3.1.

| Version | OutLayer version key (WASM SHA-256)                                | State                                                                                                                                                 |
| ------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0.3.0   | `09f4ce1b…` (330,322 bytes, commit `3dab63d`)                      | Replaced. Verdict v2, the policy step, the `AccountTransfer` request, NEP-413 enrollment and `template:v3:<owner>`. It removed the vault.             |
| 0.3.1   | `5b6fad5df11440847e13508f57736da8de371526824cf12178dfc20be2c9c1d1` | Replaced. 334,704 bytes, commit `446882b`. It adds the forgiving word check for a send sentence. |
| 0.4.0   | `8a0b7ba0dff61a4b45e5d1d164c011525e11fe9f4fd02a4e22368882447329ef` | Built and added to the OutLayer project on 2026-11-09. **Not active**: a call reaches it only if the caller sets `version_key`. It adds `community_note` and `note_rating`. Transfers are unchanged. |
| 0.5.1   | `cdb46fea7fab5afbb855e373674c80a9cd77170beb594579da28d754009e7258` | Replaced on 2026-11-09 at 17:04 UTC (365,426 bytes, `build.sh --docker`, FastFS tx `A4zDd9E6sm1ZjSj3uVukTcTnoYZG83ntv1DqnS7A9w8R`, `add_version` tx `BGZ3QRPGaUzJ4x3Z7wcNq3yJ3xMYnAwS3rnPQfY69MTb`). It writes the used-audio mark during the requests (0.16–0.20 s off each `verify`) and times the responses between the storage calls. It includes the merge approvals of 0.5.0. The Mac build of the same source was `aae02d5e…`. |
| 0.5.2   | `96b79b518613a50538b060da2279c91e12b0619499c532c2708f61ddb790d7e5` | **Active** since 2026-11-09 at 17:04 UTC (373,865 bytes, `build.sh --docker`, FastFS tx `7zwppPbVm5AMmFQ18m9dWCYax4mA4zTrHupVnuhQpFnD`, `add_version` tx `A81vUiuvEdsCyFKrFwzZdQe3gVfFTXuse5ue4Qi5g7L2`). No change in behaviour: the code is reorganised. The signed output is the same as 0.5.1, except the version. |
| 0.6.0   | `566e8cbc874b92a805d84360e6bab5c4f1c5b4eb276b518a207142be06fefbc9` | Added to the OutLayer project on 2026-11-10 (396,771 bytes, `build.sh --docker`, FastFS tx `5VUpXWs653GegtePhTHYsc4TRUgzEXP5cKC2ZUmg4V9M`, `add_version` tx `EZjs5T1yY859sb2moQkjHYeFyyh8qLrXycV11YdKyqb4`). **Not active**: a call reaches it only if the caller sets `version_key`. It adds `multisig_propose` and `multisig_confirm` for the voice multisig demo. The other kinds are unchanged, except the version in the verdict. |
| 0.6.1   | `f56ba0e8942a5fcd1b2ed500bf9013953bccefb22b375c2830c2b0a01508e7cb` | Added to the OutLayer project on 2026-11-10 (397,623 bytes, `build.sh --docker`, FastFS tx `7sWJVYsV1Fkdmq4sW1GDZRE47w89L64NJwfL38AoGh5Q`, `add_version` tx `81nFKGTvg2DBgcTW6YN2YfUF57qDS1bBcXsEK5qJCE51`). **Not active**: the voice multisig route selects it by `version_key`. In a multisig proposal of a transfer, the send part gets the send-sentence forgiveness: "point" for "dot", "dash" left out or said as "hyphen", and the receiver matched by sound. A confirmation keeps the exact words. The other kinds are unchanged, except the version in the verdict. |
| 0.7.0   | not built for OutLayer yet | The source on this branch. It adds `multisig_hide_note` for the voice multisig page ("hide note N"). The other kinds are unchanged, except the version in the verdict. Build it with `build.sh --docker`, add it to the OutLayer project, and set its hash as `VOICE_OUTLAYER_VERSION_KEY` of the demo site. |
| 0.8.0   | `b0f53da49a3f7ece81a99879d6c1c9af30343d0c5ae9c0c46e6a850d2f64bff3` | Added to the OutLayer project on 2026-11-10 (421,745 bytes, `build.sh --docker`, FastFS tx `C7ANV9NzfpZYoJaJxc5kzZbCttg14RPhYC8syqv8pq85`, `add_version` tx `F8orYFRTJybc26s6Sa1L329HbLkRfDfqhoXDKAb7Roq7`). **Not active**: a call reaches it only if the caller sets `version_key`. It adds the request kind `market_bet` (a spoken bet of the note market: "bet zero point five usdc yes on market nine"). The other kinds are unchanged, except the version in the verdict. The Seams staging Gateway pins it. |
| 0.9.0   | not built for OutLayer yet | The source on this branch. Adds the general kinds `transaction` (any NEAR transaction or delegate action: the owner says a summary, the verdict binds the receiver and the SHA-256 of the actions) and `signed_message` (a NEP-413 message: the verdict binds the 32 bytes that the key signs). Wallet SDK 0.66.0 needs it for `signAndSendTransaction`, `signTransaction`, `signDelegateAction` and `signMessage` of `seams.near.speakToSign`. |
| 0.8.0 (standalone preview) | `599755ada81762764b0d387a632bc12f5402f11d80e050b510e111995bdedf2f` | A build of the branch `claude/standalone-library-3e4d17` at commit `21ad633`, before it took a new version number. It writes `0.8.0` in a verdict. It has the kinds of 0.8.0 and the general kinds of 0.9.0. It also adds, for use with no wallet and no chain: the application owner (`app:<id>`), the request kind `confirmation`, the operations `select` and `transcribe`, and the variant `local-speaker`. Added to the OutLayer project on 2026-11-11 (458,081 bytes, `build.sh --docker`, commit `21ad633`, FastFS tx `GPDF3s9pNwA8rxu7pbRjjvtFbBEW7hc1Sz7H2Xf1Ryg`, `add_version` tx `BSFZLLgM5PQ4v5bS8MJC7VKe2fR7MZ4YEDVS4kYaEYwN`). **Not active**: a call reaches it only with `version_key`. |
| 0.8.0 (standalone preview, `local-speaker`) | `ca07893319b7d3f7861630acd081d169e9ed6b09027c9f20e7a592260ada6306` | The same source with ReDimNet inside the worker (8,266,175 bytes, `build.sh --local-speaker --docker`, commit `21ad633`). Added on 2026-11-11 (`add_version` tx `5R5SR8Fs3Rn8HXLUYuSGdy3BK6PnCCYCciNz5ScJ29KH`; the FastFS upload needed three tries, the first chunk of the third is `ENETpnXinnmVA8t3W8afbg4XDsi4AshNvaxsQpkkKzFm`). **Not active.** A call needs `version_key` and the header `X-Compute-Limit`. |
| 0.10.0  | not built for OutLayer yet | The source on this branch. It adds, for use with no wallet and no chain: the application owner (`app:<id>`), the request kind `confirmation`, the operations `select` and `transcribe`, the variant `local-speaker`, and numbers in a spoken summary. The two "standalone preview" builds above have all of it except the numbers. |

Three builds on OutLayer write `"verifier":"0.8.0"` in a verdict:
`b0f53da4…bff3` and the two "standalone preview" builds. So that text does
not name one build. Use the version key. On 2026-11-11 the active version of
the project was still 0.5.2 (`96b79b51…d7e5`), and all three builds were in
the version list (views `get_project` and `list_versions` of
`outlayer.testnet`).

The transaction hashes of the FastFS upload and of `add_version` for 0.4.0 are
in the repository README.

## Build and test

```sh
cargo test           # native tests (fake host), and the shared vectors
./build.sh           # release WASM, size and SHA-256; fails at 1,000,000 bytes
./build.sh --docker  # the same build in the pinned x86_64 Linux image
```

`build.sh` honors `CARGO_TARGET_DIR`. `rust-toolchain.toml` pins Rust 1.97.1
with the `wasm32-wasip2` target. rustup installs it on the first call.

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

Expected for the source of version 0.6.1:

```text
host   x86_64-unknown-linux-gnu
bytes  397623
sha256 f56ba0e8942a5fcd1b2ed500bf9013953bccefb22b375c2830c2b0a01508e7cb
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

The versions up to 0.5.1 in the Versions table were built on a Mac before
these changes. Their version keys depend on the folders of that Mac, so
another machine cannot build them again.

## Services

- Speaker: ReDimNet B1 in a Phala dstack CVM (`config::SPEAKER_HOST`). Each
  embedding is signed; the worker checks the signature, the nonce, the audio
  digest, the model digest and the pinned key `config::SPEAKER_PINNED_KEY_HEX`.
- Words: Whisper large-v3 on NEAR AI Cloud. Secret `NEAR_AI_API_KEY`.
- NEAR RPC: `https://test.rpc.fastnear.com` (`config::NEAR_RPC_URL`), for the
  owner's access key at enrollment only.
- `verify` sends both requests at once (`wasi:http`, one poll loop).

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
| Hosts | Phala, NEAR AI, NEAR RPC | FastFS (first run only), NEAR AI, NEAR RPC |
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

`verify` reads the template, then writes the used-audio mark with one atomic
set-if-absent, while the requests are in flight (0.5.1 and later). So the
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
| `redimnet`   | yes      |          | the service's own model time                                       |
| `rpc`        |          | yes      | NEAR RPC access-key view response                                  |
| `mark`       | yes      |          | used-audio write, inside `storage`                                 |
| `policy`     | yes      |          | the policy step                                                    |
| `write`      |          | yes      | used-audio writes and the template write                           |
| `sign`       | yes      |          | verdict signature                                                  |
| `total`      | yes      | yes      | the whole operation                                                |

## Inputs

- `enroll`: `{"op":"enroll","owner","audio_wav_b64":[3 WAVs],"authorization":{"public_key","signature_b64","nonce_b64"}}`.
- `verify`: `{"op":"verify","owner","request":{"kind":"transfer","receiver","amount_yocto"},"contacts":[...],"audio_wav_b64"}`.
  - `request` is tagged by `kind`:
    - `transfer`: a native NEAR transfer from `owner` to `receiver`, as
      `spoken_intent::SpokenRequestV1::AccountTransfer`. The receiver must be
      a named account that the text can say, and not the owner.
    - `community_note` (0.4.0 and later):
      `{"contract","post_id","note_sha256_hex","summary"}`, as
      `SpokenRequestV1::CommunityNote`. The owner says only the summary:
      1 to 12 words of ASCII letters (`spoken_intent::SpokenSummary`). The
      note is bound by its SHA-256 (64 lowercase hex characters).
    - `note_rating` (0.4.0 and later): `{"contract","note_id","rating"}` with
      `rating` `helpful`, `somewhat_helpful` or `not_helpful`, as
      `SpokenRequestV1::NoteRating`. The owner says "this note is helpful",
      "this note is somewhat helpful" or "this note is not helpful".
    - `merge_approval` (0.5.0 and later):
      `{"contract","repo_sha256_hex","pull_request","base","head_commit_hex"}`,
      as `SpokenRequestV1::MergeApproval`. The owner says "merge pull request
      <number> into <base>", for example "merge pull request forty two into
      main". `pull_request` is 1 or more. `base` is 1 to 32 ASCII lowercase
      letters (`spoken_intent::SpokenBranch`). The repository is bound by the
      SHA-256 of its name (64 lowercase hex characters) and the head commit
      by its 20-byte id (40 lowercase hex characters). It moves no value: the
      Wallet calls only `approve_merge`, with no deposit. Any other value
      refuses with `unsupported`.
    - `multisig_propose` (0.6.0 and later):
      `{"multisig","proposal_id","receiver","amount_yocto"}`. The proposer
      says "approve proposal <id>, send <amount> NEAR to <receiver>". The
      worker draws a 32-byte salt and builds
      `SpokenRequestV1::MultisigApproval`. Its request digest binds the
      salted commitment, not the proposal (`spoken_intent::multisig_approval_digest`).
      On an accept the worker stores the proposal and the salt, and the
      output has `"multisig":{"commitment","salt"}` (base64url) and no stage
      times, so that it stays below 1,024 bytes.
    - `multisig_hide_note` (0.7.0 and later):
      `{"multisig","proposal_id","note_id"}`, with `note_id` 1 or more. The
      proposer says "approve proposal <id>, hide note <note id>" with the
      exact words. Like `multisig_propose`, the worker draws the salt,
      stores the proposal (`{"proposal_id","note_id","salt_hex"}`) and
      returns the commitment and the salt. The near misses are the note id
      one lower, one higher, and with each digit changed.
    - `multisig_confirm` (0.6.0 and later):
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
    - Numbers in a summary (all summary kinds, version 0.10.0 and later):
      write the number in words ("Pay forty dollars for two books"). The
      model can write it as a numeral, and the worker reads "40", "$40" and
      "40 dollars" as the same words. It reads `$`, the euro sign and the
      pound sign before a whole number, and `%` after a number. An amount
      with a decimal point ("$2.50") has no single spoken form: do not put
      one in a summary. In the builds before 0.10.0, "$40" fails the word
      check (seen on testnet).
    - The contract `demo/contracts/voice-multisig` checks each verdict of
      these kinds on chain. `Transfer` and `HideNote` proposals exist. A
      0.6 record of a transfer still reads in 0.7.0.
  - The words must match the rendered text of the request. A rating and a
    merge approval need the exact words. Two kinds of forgiveness exist;
    each applies to words that hold no value:
    - Send sentence (0.3.1 and later; `spoken-intent` commit `92c21bc`,
      `976167297` in seams-wallet): the
      first word "sent" or "sends" counts as "send"; a closed list of
      sound-alikes of "near" and of "testnet" counts as the word itself; a
      number sound-alike counts as the number word in the amount slot; and a
      receiver one sound from a known account (the receiver or a contact)
      counts as that account. The amount and the receiver are still compared
      with the request. Negations, other units and added clauses are refused.
    - Multisig proposal of a transfer (0.6.1 and later): in "approve
      proposal <number> send …", the send part gets the same forgiveness. So
      "seams grants point testnet" and "seams dash grants dot testnet" both
      count as `seams-grants.testnet`. A confirmation (`multisig_confirm`)
      adds no receiver to the known accounts: a match by sound would write
      the hidden receiver into `heard`. Its send part gets only the verb,
      amount and unit rules.
    - Community note summary (0.4.0 and later): a summary of 4 or more words
      also passes with one word changed or dropped, when the heard words are
      still closer to the summary than to every near miss (an added or dropped
      "not" never passes).
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
- Unknown fields are refused at every level.
- WAV: 16 kHz mono PCM16, at most 8 s, standard base64. The worker writes it
  again with a 44-byte header (the canonical WAV); the audio digest is the
  SHA-256 of the canonical WAV.

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
- The output stays below 1,024 bytes; `heard` is cut to fit.

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

## Vendored crate

`vendor/bit-vec` is kept for `voice-probe`, which patches to it.
