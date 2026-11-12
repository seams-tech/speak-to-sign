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

The source on this branch is version 0.14.1 (`config::VERIFIER_VERSION`). The
sections below say when a feature needs a later version than 0.3.1.

| Version | OutLayer version key (WASM SHA-256)                                | State                                                                                                                                                 |
| ------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0.3.0   | `09f4ce1b…` (330,322 bytes, commit `3dab63d`)                      | Replaced. Verdict v2, the policy step, the `AccountTransfer` request, NEP-413 enrollment and `template:v3:<owner>`. It removed the vault.             |
| 0.3.1   | `5b6fad5df11440847e13508f57736da8de371526824cf12178dfc20be2c9c1d1` | Replaced. 334,704 bytes, commit `446882b`. It adds the forgiving word check for a send sentence. |
| 0.4.0   | `8a0b7ba0dff61a4b45e5d1d164c011525e11fe9f4fd02a4e22368882447329ef` | Built and added to the OutLayer project on 2026-11-09. **Not active**: a call reaches it only if the caller sets `version_key`. It adds `community_note` and `note_rating`. Transfers are unchanged. |
| 0.5.1   | `cdb46fea7fab5afbb855e373674c80a9cd77170beb594579da28d754009e7258` | Replaced on 2026-11-09 at 17:04 UTC (365,426 bytes, `build.sh --docker`, FastFS tx `A4zDd9E6sm1ZjSj3uVukTcTnoYZG83ntv1DqnS7A9w8R`, `add_version` tx `BGZ3QRPGaUzJ4x3Z7wcNq3yJ3xMYnAwS3rnPQfY69MTb`). It writes the used-audio mark during the requests (0.16–0.20 s off each `verify`) and times the responses between the storage calls. It includes the merge approvals of 0.5.0. The Mac build of the same source was `aae02d5e…`. |
| 0.5.2   | `96b79b518613a50538b060da2279c91e12b0619499c532c2708f61ddb790d7e5` | Active from 2026-11-09 at 17:04 UTC to 2026-11-11 (373,865 bytes, `build.sh --docker`, FastFS tx `7zwppPbVm5AMmFQ18m9dWCYax4mA4zTrHupVnuhQpFnD`, `add_version` tx `A81vUiuvEdsCyFKrFwzZdQe3gVfFTXuse5ue4Qi5g7L2`). No change in behaviour: the code is reorganised. The signed output is the same as 0.5.1, except the version. |
| 0.6.0   | `566e8cbc874b92a805d84360e6bab5c4f1c5b4eb276b518a207142be06fefbc9` | Added to the OutLayer project on 2026-11-10 (396,771 bytes, `build.sh --docker`, FastFS tx `5VUpXWs653GegtePhTHYsc4TRUgzEXP5cKC2ZUmg4V9M`, `add_version` tx `EZjs5T1yY859sb2moQkjHYeFyyh8qLrXycV11YdKyqb4`). **Not active**: a call reaches it only if the caller sets `version_key`. It adds `multisig_propose` and `multisig_confirm` for the voice multisig demo. The other kinds are unchanged, except the version in the verdict. |
| 0.6.1   | `f56ba0e8942a5fcd1b2ed500bf9013953bccefb22b375c2830c2b0a01508e7cb` | Added to the OutLayer project on 2026-11-10 (397,623 bytes, `build.sh --docker`, FastFS tx `7sWJVYsV1Fkdmq4sW1GDZRE47w89L64NJwfL38AoGh5Q`, `add_version` tx `81nFKGTvg2DBgcTW6YN2YfUF57qDS1bBcXsEK5qJCE51`). **Not active**: the voice multisig route of the demo selected it by `version_key`, until that route was removed on 2026-11-12. In a multisig proposal of a transfer, the send part gets the send-sentence forgiveness: "point" for "dot", "dash" left out or said as "hyphen", and the receiver matched by sound. A confirmation keeps the exact words. The other kinds are unchanged, except the version in the verdict. |
| 0.7.0   | never built for OutLayer | It adds `multisig_hide_note` for the voice multisig page ("hide note N"); 0.8.0 and later have it. The other kinds are unchanged, except the version in the verdict. |
| 0.8.0   | `b0f53da49a3f7ece81a99879d6c1c9af30343d0c5ae9c0c46e6a850d2f64bff3` | Added to the OutLayer project on 2026-11-10 (421,745 bytes, `build.sh --docker`, FastFS tx `C7ANV9NzfpZYoJaJxc5kzZbCttg14RPhYC8syqv8pq85`, `add_version` tx `F8orYFRTJybc26s6Sa1L329HbLkRfDfqhoXDKAb7Roq7`). **Not active**: a call reaches it only if the caller sets `version_key`. It adds the request kind `market_bet` (a spoken bet of the note market: "bet zero point five usdc yes on market nine"). The other kinds are unchanged, except the version in the verdict. |
| 0.9.0   | `6725917bd01355f08bb402271dff6265c0d03650c1b1acf8d0992b2537d65ef1` | Added to the OutLayer project on 2026-11-10 (432,675 bytes, `build.sh --docker` from commit `072c616`, FastFS tx `8uY35daAbCWwiJ4ZWXDzFuPpTPybP21YPTPo6TEgiL4y`, `add_version` tx `4MziPaaCvU33cywvA8bvTc2NStJADcLWJYXsq7CCVu9h`). **Not active**: a call reaches it only if the caller sets `version_key`. It adds the general request kinds `transaction` (the receiver and the SHA-256 of the action bytes) and `signed_message` (the SHA-256 of the NEP-413 bytes), each with a spoken summary. The other kinds are unchanged, except the version in the verdict. Wallet 0.66.0 needs it for `signAndSendTransaction`, `signTransaction`, `signDelegateAction` and `signMessage`. |
| 0.8.0 (standalone preview) | `599755ada81762764b0d387a632bc12f5402f11d80e050b510e111995bdedf2f` | A build of the branch `claude/standalone-library-3e4d17` at commit `21ad633`, before it took a new version number. It writes `0.8.0` in a verdict. It has the kinds of 0.8.0 and the general kinds of 0.9.0. It also adds, for use with no wallet and no chain: the application owner (`app:<id>`), the request kind `confirmation`, the operations `select` and `transcribe`, and the variant `local-speaker`. Added to the OutLayer project on 2026-11-11 (458,081 bytes, `build.sh --docker`, commit `21ad633`, FastFS tx `GPDF3s9pNwA8rxu7pbRjjvtFbBEW7hc1Sz7H2Xf1Ryg`, `add_version` tx `BSFZLLgM5PQ4v5bS8MJC7VKe2fR7MZ4YEDVS4kYaEYwN`). **Not active**: a call reaches it only with `version_key`. |
| 0.8.0 (standalone preview, `local-speaker`) | `ca07893319b7d3f7861630acd081d169e9ed6b09027c9f20e7a592260ada6306` | The same source with ReDimNet inside the worker (8,266,175 bytes, `build.sh --local-speaker --docker`, commit `21ad633`). Added on 2026-11-11 (`add_version` tx `5R5SR8Fs3Rn8HXLUYuSGdy3BK6PnCCYCciNz5ScJ29KH`; the FastFS upload needed three tries, the first chunk of the third is `ENETpnXinnmVA8t3W8afbg4XDsi4AshNvaxsQpkkKzFm`). **Not active.** A call needs `version_key` and the header `X-Compute-Limit`. |
| 0.10.0  | `9b0609fa1e46e5d8b6b00f96b10b375c248e8cf200ccea8e1adbbc8ea52d44eb` | The source on this branch at commit `d3e02bc` (460,283 bytes, `build.sh --docker`). Added to the OutLayer project on 2026-11-11 (FastFS tx `AVaXXBDYpERq5bNef7fAM7CF4HaZNeXuZpJiTr4jGEhw`, `add_version` tx `S4RvnDPMhkxkCoxHG8Rx9KtUyfSAstG4kmjj2BhaU4t`). **Not active.** It adds, for use with no wallet and no chain: the application owner (`app:<id>`), the request kind `confirmation`, the operations `select` and `transcribe`. For every summary kind it reads "$40" as "forty dollars", and one changed word is never a number word. |
| 0.10.0 `local-speaker` | `92c5416de98e944ca669ed10cd028ea9ab5e10b1baa87460c45eddeb6c1dc88f` | The same source with ReDimNet inside the worker (`build.sh --local-speaker --docker`). Added on 2026-11-11 (first FastFS chunk tx `GRbHuHVDmf6Ya9YH8CRiexxCLxU1hCovjqEaDsrg7hx3`, `add_version` tx `6hQKZyNrVTbCY5V5GKYuFCh4SfZKWfdL3nwVqa3vjscq`). **Not active.** A call needs `version_key` and the header `X-Compute-Limit`. |
| 0.11.0  | `d2f8b63016e6465d614240989f60ff60ad1d0d8dcff7c247e2d4306fc197d9f8` | The source on this branch at commit `be35842` (507,649 bytes, `build.sh --docker`). Added to the OutLayer project on 2026-11-11 (FastFS tx `E5DDUHW7UL9rehTyFQ4TQzsVphMi5rdeqeGxgvBNMQAa`, `add_version` tx `CkUMmoDiE7QmXZDzkzQgi8xB83iczem4T9s11kd9d9wL`). Was active from 2026-11-11 (`set_active_version` tx `69Y2qLzLeQ2WTN6UYAkA5iUqa4b1AtLCYrXPtaEoWUiy`) until 0.12.0 became active the same day. It adds the operation `detect`. |
| 0.11.0 `local-speaker` | `febb4cb84b09285a541fbbf7d74176504fc7be24f09055f86c4cf3f68349ad00` | The same source with ReDimNet inside the worker. Added on 2026-11-11 (first FastFS chunk tx `3sNi1vRtfdESuxJNpVSodvgwUueM9hqKibWWidpFgL6x`, `add_version` tx `2gdj8j7xAizq8daGu1WfnwhA6o87UQV8wRuBAK8caLxn`). **Not active.** |
| 0.10.0 (sealed-audio preview) | `e322edae8c1497a4ecbc6f51ee67c9b25ef08cd48bcf2cd64fa7f5f6fba3af09` | A build of sealed audio on the older `dev` commit `1a8721b`, before the port to this branch (473,612 bytes, `build.sh --docker`, FastFS tx `9nYihYjxBS8F7i5qm1X1niTUvFu7bDQpc7WysaHxHWht`, `add_version` tx `2R6Y82H1dEmmFDiQqcYMntYQwnzbh8kn3sfLBxttJMom`). **Not active.** It writes `0.10.0` in a verdict and does not have `select`, `transcribe` or `detect`. It has `audio_key` and sealed audio for `verify` and `enroll`, with AES-256-GCM in place of ChaCha20-Poly1305, so a clip sealed for this source does not open there. Do not use it. |
| 0.12.0  | `bfe81633b9ed596df239201f153a84c860d71ddd8edf713c1c785ef2b7c1c946` | The source on this branch at commit `a816798` (536,004 bytes, `build.sh --docker`). Added to the OutLayer project on 2026-11-11 (FastFS tx `3ZTwf8cWSAo4m8wNuvabsNynVwW3bcUZ4gfGB4n2MiuZ`, `add_version` tx `ByxnDTxpbs7pyDa4j6WahS7dpJYwGM4sLYSvvUx1cbai`). **Active** since 2026-11-11 (`set_active_version` tx `HBL4Uk7z4gwVDRJ8CncSsSe2YrXx85moYc7kvfYzHERc`): a call with no `version_key` runs it. Before the switch, a test with plain audio gave the expected result for `enroll`, `verify` (the word check and the speaker check too), `select`, `transcribe` and `detect`, each with its TDX quote bound to this WASM. The `local-speaker` variant is not built. Adds sealed audio: `verify`, `enroll`, `select`, `transcribe` and `detect` take each recording in `audio_sealed_b64` (HPKE to the audio key, the OutLayer secret `PROTECTED_AUDIO_KEY`) in place of `audio_wav_b64`, and the new operation `audio_key` returns the audio public key with a signature of the verdict key. Plain audio works as before. See "Sealed audio" below. |
| 0.13.0  | `1b7771544f3bcf5b3ba9e9bf3ac611f6abad21e7538f67b2666fd8aafc8cf930` | The source on this branch at commit `a4d6ce7` (548,960 bytes, `build.sh --docker`). Added to the OutLayer project on 2026-11-12 (FastFS tx `7MFXux9gJQHPHBKJtGacMKgpa3AUfgFhyNNQrvHdLGBz`, `add_version` tx `5DVbadJ1CSwyxkdi5oRGjLvRtySvQQoD3umnkXzo9zB4`). **Not active**: a call reaches it only with `version_key`. The Seams staging server pins it from Wallet 0.69.0. A `community_note` request takes the note text (`note_text`, 1 to 280 characters) in place of `note_sha256_hex`, and the verifier calculates the SHA-256 itself. JEV checks that the summary gives the main point of the note; a fit below 600 thousandths refuses with `summary_mismatch`, and no answer refuses with `summary_check_unavailable`. A Wallet that sends `note_sha256_hex` gets `unsupported`, so the Wallet and this build go live together. See "Note summary check" below. |
| 0.14.0 (first build, with `dcap-qvl`) | `2f8e75a3590e90518c344f4683a8912fd0876ab3f000981a002f1741b607ffb5` | The source at commit `6f0d43f` (1,038,333 bytes, `build.sh --docker` before the `wasm-opt` step). Added to the OutLayer project on 2026-11-12 (FastFS tx `12q7t1fcC2biqRRuKveo7LUWLREx3MfD2SSGN6tydxja`, `add_version` tx `CRbDmxzJWqLXCvwrfKGKdUWQ1UWJ6xm8FmKRYcuuojHa`). **Not active**, and no caller selects it. It checks NEAR AI's attestation and sends each recording to Whisper only sealed to the checked gateway (see "NEAR AI attestation"). In a test on 2026-11-12 its first call ran the check inside OutLayer (424.8 million instructions), and two later calls read the stored result (`tee_cached` 1, `tee` 63 and 189 ms). NEAR AI Whisper gave no reply during the test, so no call came to a verdict. Its load time is about 1.1 s above 0.13.0 (see "Size and load time"). **Removed from the OutLayer project on 2026-11-12** (`remove_version` tx `Akuxz76BL6H9CRZWEsR525dfYv3Um2SoFTcPtYUBGV9E`), so a call with this key fails. |
| 0.14.0 (before the speech-to-text adapter) | Not on OutLayer | The source at commit `ab8f6bc` (494,721 bytes, sha256 `d265bf0588700be099c74e7c905f9b542004e95aad28fce8a2db71b4398a3416`, `build.sh --docker`). The same check as the first build, with the worker's own TDX quote check in place of `dcap-qvl`. It writes `0.14.0` in a verdict, as the first build does, so that text does not name one build. |
| 0.14.0 | `b9a315b7a5f7c730437b432d860e6e5b8d8216a9e753eb66bd74d4c788849293` | The source at commit `454c76e`, with the speech-to-text adapter (495,707 bytes, `build.sh --docker`). Added to the OutLayer project on 2026-11-12 (FastFS tx `EgHoTjLDS1NHMU5oYet9cGbW7Z8kKDd1qkmEGMEuTncK`, `add_version` tx `7JB9gA17Xn8LWkNB2iGyvuTnBhP6tP3Smi3UbqGUF29q`). **Not active.** Three `verify` calls got the checked gateway from the worker storage (`tee` 49 to 230 ms) and then no reply of NEAR AI Whisper, which was down. It writes `0.14.0`, as two earlier builds do. Use 0.14.1. |
| 0.14.0+venice | `59ee371cac571d8ef611baf0d1f6f9a9a9b568f87f56f5d2e2a2a38e3b07fa66` | The `venice` build of commit `454c76e` (400,206 bytes, `build.sh --venice --docker`). Added on 2026-11-12 (FastFS tx `4uZrJVGTfht1kKHRrQxx45De3HnAeW4cXW8YGFYhsDBm`, `add_version` tx `Bnapmuj5E4kXxfpezSxXBVoaqK4b68gQ94mP5Ga8Rf2c`). **Removed from the OutLayer project on 2026-11-12** (`remove_version` tx `8qEVS3jc68r8WAaVGGoP7NpWp2etexeiwsw8GBMTBxX`), so a call with this key fails. The reason: it sends the file part as `audio/wav`, and Venice answers 422, so each call with words refuses with `transcriber_unavailable` (`transcriber: status_422`). |
| 0.14.1 | `1e7c6968bbfcf6d3193874d12988054114a004f7e10ccf8c1aeddfdca6d38a5c` | The default build of commit `62cd438` (495,774 bytes, `build.sh --docker`). Added to the OutLayer project on 2026-11-12 (FastFS tx `DSd4t1o5qmhVsexzQcGnTtKbKLs3NS7jAU2UfSK8xKzt`, `add_version` tx `AJ6excNhQnY4MRkQdAxqoqNXX88yCPA2iV2oMcrfBki9`). **Not active**: a call reaches it only with `version_key`. It answers `audio_key` as `0.14.1`. The same behaviour as 0.14.0 `b9a315b7…`; the version number says that it is a build with the Venice fix. |
| 0.14.1+venice | `344b8b479a42de612942c2811f21e0e09462deb9c1d873dd2929b052bdabd3c8` | The `venice` build of commit `62cd438` (400,267 bytes, `build.sh --venice --docker`). Added on 2026-11-12 (FastFS tx `3GoiG3msinq45Hue3P2eBarsJ8KyGqcQqPaW2v8DzaR6`, `add_version` tx `7spkQGnfQGbDJm8dFQnxY7MapYkk4LoDjhdZQzF5u8ip`). **Not active**: a call reaches it only with `version_key`. It sends the file part as `audio/x-wav`, which Venice accepts. The first real recordings through it are the two verdicts of proposal 3 of the voice multisig (`demo/contracts/voice-multisig/README.md`, "Live run on testnet"). See "Speech-to-text service". |

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

Expected for the source of version 0.13.0 (commit `a4d6ce7`; the later
commits change only this README), on 2026-11-12:

```text
host   x86_64-unknown-linux-gnu
bytes  548960
sha256 1b7771544f3bcf5b3ba9e9bf3ac611f6abad21e7538f67b2666fd8aafc8cf930
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

The versions up to 0.5.1 in the Versions table were built on a Mac before
these changes. Their version keys depend on the folders of that Mac, so
another machine cannot build them again.

## Size and load time

OutLayer loads the compiled WASM on each call: it reads the file, checks its
hash and its signature, and deserializes it. No loaded module stays in
memory (`worker/src/compiled_cache.rs` of OutLayer). So the size of the WASM
is time on each call.

Measured on OutLayer testnet on 2026-11-12, with an input that does no work
(`{"op":"none"}`), five calls for each version, in turn:

| Version | WASM bytes | `time_ms`, median |
| ------- | ---------- | ----------------- |
| 0.5.2   | 373,865    | 1,169             |
| 0.10.0  | 460,283    | 1,440             |
| 0.12.0  | 536,004    | 1,622             |
| 0.13.0  | 548,960    | 1,641             |
| 0.14.0 with dcap-qvl (`2f8e75a3…`) | 1,038,333 | 2,723 |

That is about 2.3 ms for each KB. The value changes with the day (about
1 ms for each KB on 2026-11-11), so compare two versions only in the same
run. What made the worker smaller, for the source with the NEAR AI check
(`./build.sh --docker`):

| Step                                                         | WASM bytes |
| ------------------------------------------------------------ | ---------- |
| The first build of 0.14.0, with dcap-qvl                     | 1,038,333  |
| `wasm-opt -Oz` in `build.sh`                                 | 851,975    |
| The worker's own TDX quote check in place of dcap-qvl        | 560,034    |
| The inputs and two model replies read by hand, without serde | 494,339    |

The time of the last three builds on OutLayer is not measured.

## Services

- Speaker: ReDimNet B1 in a Phala dstack CVM (`config::SPEAKER_HOST`). Each
  embedding is signed; the worker checks the signature, the nonce, the audio
  digest, the model digest and the pinned key `config::SPEAKER_PINNED_KEY_HEX`.
- Words: Whisper large-v3 on NEAR AI Cloud. Secret `NEAR_AI_API_KEY`. In
  0.14.0 and later, the whole request (with the key) goes sealed with
  Oblivious HTTP to the NEAR AI gateway that the worker checked, and the
  worker reads the attestation report of NEAR AI and Intel's collateral when
  its stored check is older than 6 hours. See "NEAR AI attestation".
- Note summary (0.13.0 and later): JEV (`typesafe/jev-1.13`, Typesafe System
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
| Hosts | Phala, NEAR AI, NEAR RPC, Intel PCS (0.14.0 and later) | FastFS (first run only), NEAR AI, NEAR RPC, Intel PCS (0.14.0 and later) |
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

A later run (0.11.0, 2026-11-11) showed that the read of the model from
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
| Version in each signed output | `0.14.1` | `0.14.1+venice` |
| OutLayer secret | `NEAR_AI_API_KEY` | `VENICE_API_KEY`, and `NEAR_AI_API_KEY` for a note and for `detect` |
| Manifest | `manifest/outlayer.json` | `manifest/outlayer-venice.json`: `api.venice.ai` in place of the two Intel hosts |
| Worker (`--docker`, this commit) | 495,774 bytes | 400,267 bytes: the gateway check is not in it |

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
  and intent is `0.14.1+venice`, and the TDX quote of the call names the
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
| `tee`        | yes      |          | 0.14.0 and later: get the checked NEAR AI gateway, while the speaker request is in flight |
| `tee_cached` | yes      |          | 1: the stored check; 0: a new check; 2: the stored check, because the new one could not reach a service |
| `summary`    | yes      |          | JEV response, a community note only (0.13.0 and later)             |
| `redimnet`   | yes      |          | the service's own model time                                       |
| `rpc`        |          | yes      | NEAR RPC access-key view response                                  |
| `mark`       | yes      |          | used-audio write, inside `storage`                                 |
| `policy`     | yes      |          | the policy step                                                    |
| `write`      |          | yes      | used-audio writes and the template write                           |
| `sign`       | yes      |          | verdict signature                                                  |
| `total`      | yes      | yes      | the whole operation                                                |

## Inputs

- `audio_key` (0.12.0 and later): `{"op":"audio_key"}`.
- Each recording is a plain WAV in `audio_wav_b64`, as below, or a sealed one in `audio_sealed_b64` (0.12.0 and later, see "Sealed audio").
- `enroll`: `{"op":"enroll","owner","audio_wav_b64":[3 WAVs],"authorization":{"public_key","signature_b64","nonce_b64"}}`.
- `verify`: `{"op":"verify","owner","request":{"kind":"transfer","receiver","amount_yocto"},"contacts":[...],"audio_wav_b64"}`.
  - `request` is tagged by `kind`:
    - `transfer`: a native NEAR transfer from `owner` to `receiver`, as
      `spoken_intent::SpokenRequestV1::AccountTransfer`. The receiver must be
      a named account that the text can say, and not the owner.
    - `community_note` (0.4.0 and later):
      `{"contract","post_id","note_text","summary"}`, as
      `SpokenRequestV1::CommunityNote`. The owner says only the summary:
      1 to 12 words of ASCII letters (`spoken_intent::SpokenSummary`). The
      note is bound by the SHA-256 of `note_text` (1 to 280 characters, not
      only white space), which the verifier calculates. The builds before
      0.13.0 take `note_sha256_hex` (64 lowercase hex characters) in place
      of `note_text`, and do not check the summary.
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
      "not" never passes). From 0.10.0, the changed or dropped word is never
      a number word: "pay fourteen dollars" does not pass for "pay forty
      dollars". The builds before 0.10.0 let it pass.
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
- `detect` (0.11.0 and later):
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

Verifier 0.13.0 and later. The owner of a community note says a summary of
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

## NEAR AI attestation

Verifier 0.14.0 and later. The worker sends each recording to Whisper only
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

Verifier 0.12.0 and later. A Wallet seals each WAV to the audio key, so the
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
