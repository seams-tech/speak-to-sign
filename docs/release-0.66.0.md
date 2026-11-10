# Release 0.66.0: Speak-to-Sign with no wallet

Status, 2026-11-11: prepared on `dev`. Nothing is published. The release
needs the steps of section 4, which only the owner of the npm organization
and of the OutLayer project can do.

## 1. What the release is

Three npm packages with one version, for an application with no Seams
Wallet and no chain:

| Package | Version | Job |
| --- | --- | --- |
| `@seams/voice-verdict` | 0.66.0 | Checks a signed verdict, a signed transcript, a signed intent and the TDX quote of a call. No dependency |
| `@seams/voice-capture` | 0.66.0 | Records one spoken sentence in the browser, with speech detection and a phrase card |
| `@seams/speak-to-sign` | 0.66.0 | Joins both: `./browser` (`recordSentence`) and `./server` (`enroll`, `confirm`, `select`, `transcribe`, `detect`) |

Not in this release:

| Package | Why |
| --- | --- |
| `@seams/speak-to-sign-wallet` (the Wallet plugin) | Its source needs `@seams/wallet` 0.66.0, and npm has 0.65.0. It is released with the Wallet, by its own workflow |
| The Rust crates | They are `publish = false`. A contract or a server uses them by path or by git |

## 2. The verifier that the release works with

The libraries need a verifier build with application owners. On OutLayer
testnet, project `seams-v1.testnet/voice-verifier`:

| Build | Version key | Has |
| --- | --- | --- |
| 0.11.0 | `d2f8b63016e6465d614240989f60ff60ad1d0d8dcff7c247e2d4306fc197d9f8` | Everything, with `detect` |
| 0.11.0 `local-speaker` | `febb4cb84b09285a541fbbf7d74176504fc7be24f09055f86c4cf3f68349ad00` | The same, with the speaker model in the worker. Slow and not stable in time |
| 0.10.0 | `9b0609fa1e46e5d8b6b00f96b10b375c248e8cf200ccea8e1adbbc8ea52d44eb` | Everything except `detect` |

None of them is the active version. The active version is 0.5.2, which the
Wallet staging route uses. A developer selects a build with `version_key`.
The source on `dev` is version 0.11.0, the same as the newest build.

## 3. What was checked

| Check | Result |
| --- | --- |
| `cargo test` in `spoken-intent`, `voice-verifier`, `voice-verdict` | Pass |
| `@seams/voice-verdict`: 32 tests (shared signed vectors, a real testnet attestation) | Pass |
| `@seams/voice-capture`: 11 tests (Chromium with a fake microphone) | Pass |
| `@seams/speak-to-sign`: 9 tests (a fake verifier that signs with a test key) | Pass |
| `@seams/speak-to-sign`: the example page in Chromium with a fake microphone, from the recording to the checked verdict | Pass |
| The server entry point against verifier 0.11.0 on OutLayer testnet, with a synthetic voice and the TDX quote check | Pass, default build |
| `npm pack --dry-run` of the three packages | Only `dist/`, the README and the licence |

Not checked: a real person's voice, and a payment key of another account
than the Seams staging account.

## 4. Steps to release (each one needs the owner)

1. **npm trusted publishing.** `@seams/voice-verdict` and
   `@seams/voice-capture` are new names. npm lets you set up trusted
   publishing only for a package that exists. So the first version of each
   new name needs one publish with a token or by hand, or an organization
   setting that allows it. `@seams/speak-to-sign` exists: add
   `release-standalone.yml` to its trusted publishers.
2. **Run the workflow** "Release the standalone libraries" with the version
   `0.66.0`. It builds, tests and publishes the three packages in order. A
   second run skips a package that is on npm.
3. **Mark the old version.** `@seams/speak-to-sign@0.65.0` on npm is the
   Wallet plugin. After the release, `latest` is the library. Run:

   ```sh
   npm deprecate @seams/speak-to-sign@0.65.0 "The Seams Wallet plugin moved to @seams/speak-to-sign-wallet. From 0.66.0 this name is the library for an application with no wallet."
   ```

4. **Decide the default verifier.** The libraries name a version key in
   their documents. If external developers must get 0.11.0 with no
   `version_key`, the project owner sets it active. That also changes the
   build that the Wallet staging route gets, if that route sends no
   `version_key`.
5. **Tag the release** on `dev` (for example `standalone-0.66.0`), after the
   packages are on npm.

## 5. What other repositories must change

- **seams-wallet, at its 0.66.0 release:** install
  `@seams/speak-to-sign-wallet` in place of `@seams/speak-to-sign`. The
  served paths and the command `seams-speak-to-sign-host` did not change.
- **seams-wallet, the TypeScript port of `spoken-intent`:** add request tag
  10 (`Confirmation`), and read `$40` as "forty dollars" and `10%` as "ten
  percent" in a transcript. The golden file has vectors for both.
- **The demo and `examples/speak-to-pay`:** they install
  `@seams/speak-to-sign@0.65.0` (the plugin). They keep working with that
  exact version. At their next update they use the new plugin name.

## 6. Known limits of 0.66.0

- The voice check does not prove that the voice is live.
- The speech-to-text model and the chat model give their answers with no
  signature. The TDX quote covers the verifier.
- English only. Testnet only.
- A summary with an amount of money that has cents ("$2.50") does not pass.
- `detect` is a proposal, and its call takes 6 to 10 s.
- The `local-speaker` build is at least 8 times slower, and three of twelve
  of its calls failed in one test run.
- `@seams/voice-verdict` does not check the signature chain of a TDX quote
  to Intel. `outlayer-verify` does.
