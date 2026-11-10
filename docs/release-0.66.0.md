# Release 0.66.0

State, 2026-11-11.

## 1. The packages

| npm name | Folder | Version | Job | Released by |
| --- | --- | --- | --- | --- |
| `@seams/speak-to-sign` | `packages/wallet-voice-sign` (from 0.67.0: `@seams/wallet-voice-sign`) | 0.66.0 | The Seams Wallet host plugin. Needs `@seams/wallet` and `@seams/voiceid` 0.66.0 | `release-wallet-voice-sign.yml`, with the Wallet |
| `@seams/voice-verdict` | `packages/voice-verdict` | 0.66.0 | Checks a signed verdict, a signed transcript, a signed intent and the TDX quote of a call. No dependency | `release-standalone.yml` |
| `@seams/voice-capture` | `packages/voice-capture` | 0.66.0 | Records one spoken sentence in the browser, with speech detection and a phrase card | `release-standalone.yml` |
| `@seams/voice-sign` | `packages/voice-sign` | 0.66.0 | For an application with no wallet: `./browser` (`recordSentence`) and `./server` (`enroll`, `confirm`, `select`, `transcribe`, `detect`). Depends on the exact versions of the two above | `release-standalone.yml` |

Owner's decisions:

- From 0.67.0 the Wallet plugin is `@seams/wallet-voice-sign`, in the folder
  `packages/wallet-voice-sign`, released by `release-wallet-voice-sign.yml`.
  0.66.0 stays on npm as `@seams/speak-to-sign`.

- `@seams/speak-to-sign` stays the name of the Wallet plugin, because the
  Wallet 0.66.0 release names it.
- The library for an application with no wallet is `@seams/voice-sign`.

The Rust crates are `publish = false`. A contract or a server uses them by
path or by git.

## 2. What is on npm

| Package | State |
| --- | --- |
| `@seams/speak-to-sign@0.66.0` | Published by the plugin workflow (run 42867738332) |
| `@seams/voice-verdict@0.66.0` | Published by hand from the owner's account. It holds two unused files of an old local build (`dist/client.js`, `dist/client.d.ts`); no export reaches them. The build now empties `dist/` first |
| `@seams/voice-capture@0.66.0` | Published by hand from the owner's account |
| `@seams/voice-sign@0.66.0` | Published by hand from the owner's account |

npm allows trusted publishing only for a package that exists. So the first
version of each new name comes from the owner's account. After that,
`scripts/npm-trust-standalone.sh` sets `release-standalone.yml` as the
trusted publisher of the three standalone names, and later releases need no
hand step.

## 3. The verifier that the libraries work with

On OutLayer testnet, project `seams-v1.testnet/voice-verifier`. None of these
builds is the active version (the active version is 0.5.2). A developer
selects a build with `version_key`.

| Build | Version key | Has |
| --- | --- | --- |
| 0.11.0 | `d2f8b63016e6465d614240989f60ff60ad1d0d8dcff7c247e2d4306fc197d9f8` | Everything, with `detect` |
| 0.11.0 `local-speaker` | `febb4cb84b09285a541fbbf7d74176504fc7be24f09055f86c4cf3f68349ad00` | The same, with the speaker model in the worker. Slow and not stable in time |
| 0.10.0 | `9b0609fa1e46e5d8b6b00f96b10b375c248e8cf200ccea8e1adbbc8ea52d44eb` | Everything except `detect` |

## 4. What was checked

| Check | Result |
| --- | --- |
| `cargo test` in `spoken-intent`, `voice-verifier`, `voice-verdict` | Pass |
| `@seams/voice-verdict`: 32 tests (shared signed vectors, a real testnet attestation) | Pass |
| `@seams/voice-capture`: 11 tests (Chromium with a fake microphone) | Pass |
| `@seams/voice-sign`: 9 tests (a fake verifier that signs with a test key) | Pass |
| `@seams/voice-sign`: the example page in Chromium with a fake microphone, from the recording to the checked verdict | Pass |
| The server entry point against verifier 0.11.0 on OutLayer testnet, with a synthetic voice and the TDX quote check | Pass, default build |
| `release-standalone.yml` on GitHub (run 42864412036): validation, build and tests of the three packages | Pass. The publish failed, because the new names did not exist on npm |

Not checked: a real person's voice, and a payment key of another account
than the Seams staging account.

## 5. Steps that are left

1. Done: `scripts/npm-trust-standalone.sh` set `release-standalone.yml` as the
   trusted publisher of `@seams/voice-verdict`, `@seams/voice-capture` and
   `@seams/voice-sign`. The next release of the three needs no hand step.
2. Decide the default verifier: if developers must get 0.11.0 with no
   `version_key`, the project owner sets it active. That also changes the
   build that the Wallet staging route gets, if that route sends no
   `version_key`.
3. At 0.67.0: the plugin is published under `@seams/wallet-voice-sign` for
   the first time. npm allows trusted publishing only for a package that
   exists, so that first version needs one publish from the owner's account
   (or the run of `release-wallet-voice-sign.yml` fails at the publish
   step). Then set `release-wallet-voice-sign.yml` as its trusted publisher,
   and mark the old name:

   ```sh
   npm deprecate @seams/speak-to-sign "Renamed: the Seams Wallet plugin is @seams/wallet-voice-sign from 0.67.0."
   ```

## 6. What other repositories must change

- **seams-wallet, at 0.67.0:** the release notes and the README install
  `@seams/wallet-voice-sign` in place of `@seams/speak-to-sign`.
- **seams-monorepo, at 0.67.0:** pin `@seams/wallet-voice-sign`. The command
  `seams-speak-to-sign-host` of the staging deploy keeps its name.

- **seams-wallet, the TypeScript port of `spoken-intent`:** add request tag
  10 (`Confirmation`), and read `$40` as "forty dollars" and `10%` as "ten
  percent" in a transcript. The golden file has vectors for both.

## 7. Known limits of 0.66.0

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
