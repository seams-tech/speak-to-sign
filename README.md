# Speak to Sign

Speak-to-Sign lets the owner of a NEAR account approve one exact call with
their own voice. The hackathon demo is community notes on an X-style page.
Testnet only.

1. You type a community note on a post. To post it, you read a short summary of the note aloud.
2. An attested verifier checks the audio: an OutLayer TEE worker, NEAR AI Whisper for the words and ReDimNet on Phala for the speaker.
3. The verifier signs a verdict. The verdict binds the speaker and the heard words to the exact note: the SHA-256 of the note text, the post, the contract and the owner. For a rating, it binds the note id and the rating.
4. Seams Wallet core checks the verdict against a pinned key. Then it signs `add_note` (or `rate_note`) on `notes.seams-v1.testnet` from the owner's own account.
5. Wallet core refuses a verdict for another note or another summary. The verifier refuses spoken words that add or drop a "not".

**Why voice and not a passkey click?** A passkey click shows that a device
approved something, not what the person agreed to. Here the owner must say
the words, and the verdict binds that voice and those words to one note.

| Item        | Link                                                    |
| ----------- | ------------------------------------------------------- |
| Demo video  | TODO: the owner adds the link to the demo video.        |
| X post      | TODO: the owner adds the link to the X post.            |
| Demo page   | `demo/README.md` tells how to run it and what must be live. |

The same verifier also approves spoken NEAR transfers
(`examples/seams-voice-intents/`).

## Reproduce without a microphone

These steps need no microphone, no NEAR account and no keys. They run the
tests that hold the binding rules, and they read the live testnet state. Each
expected output below comes from a run on 2026-11-09 on macOS 15.7.1 (arm64)
with rustc 1.97.1, Node 24.18.0 and pnpm 11.11.0. Times, and the hashes in
`target/debug/deps/` paths, can be different on your computer.
`docs/reproduce-run-2026-11-09.md` has the full record of that run.

You need:

- `git`, `curl`, `jq` and `shasum` (on Linux, `sha256sum` gives the same hash).
- Rust from rustup. `community-notes/` pins Rust 1.97.0 with the
  `wasm32-unknown-unknown` target; rustup installs it on the first `cargo` call.
- Node 24 and pnpm 11. `corepack enable` gives the pnpm version that
  `seams-wallet` pins.
- Network access. The sandbox test downloads a nearcore sandbox binary on its
  first run.

Run every command from the `speak-to-sign-check` folder that step 0 makes.

### 0. Get the code

```bash
mkdir speak-to-sign-check && cd speak-to-sign-check
```

```bash
git clone --branch speak-to-sign https://github.com/seams-tech/speak-to-sign
```

```bash
git clone https://github.com/seams-tech/seams-wallet && git -C seams-wallet checkout --quiet b12cf643c
```

`b12cf643c` is Wallet SDK 0.59.0 on the `main` branch of `seams-wallet`. The
pass counts in step 3 are for that commit. Use a full clone (no `--depth`),
because the dates in "Baseline and hackathon work" come from the history. The
full clone of `seams-wallet` is about 320 MB.

### 1. Spoken-intent golden vectors

The `spoken-intent` crate renders a request into the one English sentence
that the owner says. It also computes the request digest that the verdict
binds. `fixtures/spoken_intent_vectors_v1.json` is the golden file: 24
requests (12 transfers, 6 multisig approvals, 3 community notes, 3 note
ratings), with their sentences, Borsh bytes and digests, plus the vectors for
normalization, transcript parsing and sound-alike words.

```bash
(cd speak-to-sign/spoken-intent && cargo test 2>&1 | grep -E 'Running|Doc-tests|test result')
```

Expected (23 tests):

```text
     Running unittests src/lib.rs (target/debug/deps/spoken_intent-a16e3c61734de2f2)
test result: ok. 7 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
     Running tests/grammar.rs (target/debug/deps/grammar-4adb1047d5dc1887)
test result: ok. 15 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
     Running tests/vectors.rs (target/debug/deps/vectors-21056aa4746d8cc3)
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.03s
   Doc-tests spoken_intent
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
```

`committed_spoken_intent_vectors_match_generator` (in `tests/vectors.rs`)
fails if the committed golden file differs from what the code generates.

The Wallet checks its TypeScript port (step 3) against its own copy of this
golden file. At `b12cf643c` the copy is an earlier version of the file. Later
commits here added only transcript-reading vectors (`normalize_punctuated`).
The 24 request vectors, with their sentences, Borsh bytes and digests, are the
same in both files:

```bash
diff <(jq -S .requests speak-to-sign/spoken-intent/fixtures/spoken_intent_vectors_v1.json) <(jq -S .requests seams-wallet/crates/spoken-intent/fixtures/spoken_intent_vectors_v1.json) && echo 'the 24 request vectors are the same'
```

Expected:

```text
the 24 request vectors are the same
```

### 2. The verifier

```bash
(cd speak-to-sign/voice-verifier && cargo test 2>&1 | grep -E 'Running|Doc-tests|test result')
```

Expected (52 tests):

```text
     Running unittests src/lib.rs (target/debug/deps/seams_voice_verifier-cae52d5f128150f1)
test result: ok. 36 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s
     Running unittests src/main.rs (target/debug/deps/seams_voice_verifier-4597ef443c637af5)
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
     Running tests/enrollment_vectors.rs (target/debug/deps/enrollment_vectors-c5cfeae3f2b10ba9)
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
     Running tests/ops.rs (target/debug/deps/ops-9ea614df234bf025)
test result: ok. 13 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.85s
     Running tests/signed_vector.rs (target/debug/deps/signed_vector-554465cb2e9c7719)
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
   Doc-tests seams_voice_verifier
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
```

The note tests are in `tests/ops.rs`. They run the real `verify` operation
with a fake host. The fake host has an enrolled owner and returns the given
transcript. Each test checks the ed25519 signature of the verdict.

```bash
(cd speak-to-sign/voice-verifier && cargo test --test ops -- note rating 2>&1 | grep -E '^test')
```

Expected:

```text
test note_inputs_that_are_not_speakable_are_unsupported ... ok
test verify_accepts_a_spoken_rating_with_exact_words ... ok
test verify_accepts_a_spoken_note_summary ... ok
test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 10 filtered out; finished in 0.86s
```

`verify_accepts_a_spoken_note_summary` uses the summary "The bridge stays
open, only one lane closes." It checks these transcripts:

| Heard                                                 | Result   | Why                  |
| ----------------------------------------------------- | -------- | -------------------- |
| "The bridge stays open, only one lane closed."        | `accept` | one word changed     |
| "The bridge stays open, one lane closes."             | `accept` | one word dropped     |
| "The bridge stays open, only one lane closes today."  | `words`  | one word added       |
| "The bridge stays not open, only one lane closes."    | `words`  | a "not" added        |
| "The bridge is not open, only one lane closes."       | `words`  | a "not" added        |
| "The bridge stays shut, only two lanes close."        | `words`  | more than one word   |

For the summary "The bridge is not closed for six months", the transcript
"The bridge is closed for six months." is refused (`words`): a dropped "not"
does not pass. A summary of fewer than four words, and every rating, needs the
exact words. "This note is not helpful." for a `helpful` rating is refused.
The rule is `words_pass` in `voice-verifier/src/ops.rs`.

### 3. The Wallet verdict check

```bash
(cd seams-wallet && pnpm install --frozen-lockfile)
```

pnpm can print `[WARN] Failed to create bin ...` lines. They name scripts of
packages that this step does not build. The test does not use them.

```bash
(cd seams-wallet && pnpm -C tests exec playwright test -c playwright.wallet-browser.config.ts unit/speakToSignHost.unit.test.ts --project=chromium --reporter=list)
```

The test runs in Node and needs no browser download. Its config starts a Vite
server on port 4203. If that port is in use, put
`SEAMS_TEST_FRONTEND_URL=http://localhost:4387` before `pnpm`.

Expected (20 tests):

```text
Running 20 tests using 1 worker

  ✓   1 [chromium] › unit/speakToSignHost.unit.test.ts:172:1 › the transfer port matches every account transfer vector of the spoken-intent crate (18ms)
  ✓   2 [chromium] › unit/speakToSignHost.unit.test.ts:186:1 › only speakable accounts and whole hundredths of NEAR pass (6ms)
  ✓   3 [chromium] › unit/speakToSignHost.unit.test.ts:201:1 › the WAV is 16 kHz mono PCM16 with a 44-byte header and at most 8 s (2ms)
  ✓   4 [chromium] › unit/speakToSignHost.unit.test.ts:216:1 › the shared signed verdict vectors pass the core check as voice and voice-and-passkey (4ms)
  ✓   5 [chromium] › unit/speakToSignHost.unit.test.ts:248:1 › the core check refuses a verdict that does not bind this transfer, clip, time and key (6ms)
  ✓   6 [chromium] › unit/speakToSignHost.unit.test.ts:320:1 › a verifier refusal passes through with its reason and what was heard (0ms)
  ✓   7 [chromium] › unit/speakToSignHost.unit.test.ts:458:1 › a spoken payment verifies the typed transfer and lets core pay with the verdict (6ms)
  ✓   8 [chromium] › unit/speakToSignHost.unit.test.ts:513:1 › a refusal shows on the card, and "Try again" records the sentence again (3ms)
  ✓   9 [chromium] › unit/speakToSignHost.unit.test.ts:535:1 › a payment records at most five times, then the refusal offers only Close (6ms)
  ✓  10 [chromium] › unit/speakToSignHost.unit.test.ts:552:1 › the words that the verifier heard are aligned with the sentence and marked (1ms)
  ✓  11 [chromium] › unit/speakToSignHost.unit.test.ts:594:1 › nothing is paid for a bad request, a missing receiver, a refusal or a failed route (2ms)
  ✓  12 [chromium] › unit/speakToSignHost.unit.test.ts:627:1 › core refusals, a failed transfer and recording problems map to results (6ms)
  ✓  13 [chromium] › unit/speakToSignHost.unit.test.ts:810:1 › core records clips, checks receivers and calls only the Seams verify route (212ms)
  ✓  14 [chromium] › unit/speakToSignHost.unit.test.ts:851:1 › core pays once per flow, from the owner, with the approval the verdict names (5ms)
  ✓  15 [chromium] › unit/speakToSignHost.unit.test.ts:957:1 › a transfer that never left the Wallet lets another verdict of the flow pay (1ms)
  ✓  16 [chromium] › unit/speakToSignHost.unit.test.ts:997:1 › core signs the enrollment message only for three clips it recorded (6ms)
  ✓  17 [chromium] › unit/speakToSignHost.unit.test.ts:1075:1 › the note port matches every note and rating vector of the spoken-intent crate (5ms)
  ✓  18 [chromium] › unit/speakToSignHost.unit.test.ts:1092:1 › the summary rules match the crate (2ms)
  ✓  19 [chromium] › unit/speakToSignHost.unit.test.ts:1107:1 › a spoken note verifies the summary and lets core sign the note (2ms)
  ✓  20 [chromium] › unit/speakToSignHost.unit.test.ts:1165:1 › core signs one add_note call with no deposit for the verdict of this note only (4ms)

  20 passed (2.5s)
```

Test 20, "core signs one add_note call with no deposit for the verdict of
this note only", gives Wallet core a validly signed verdict for the same post
and note text, but with the summary "The bridge is closed.". Core refuses it with
`{ kind: 'refused', reason: 'verdict_mismatch', detail: 'request_digest differs' }`
and signs nothing. With the verdict of this note, core signs one transaction:
`add_note` on the notes contract with the note's `post_id`, `text` and
`summary`, 30 Tgas and a deposit of `0`. The code is
`signNoteWithVerdict` in
`packages/wallet/src/core/transactionFeatures/hostOperations.ts` of
`seams-wallet`.

### 4. The notes contract

Unit tests, one for each rule of the contract:

```bash
(cd speak-to-sign/community-notes && cargo test -p community-notes 2>&1 | grep -E 'Running|Doc-tests|test result')
```

Expected:

```text
     Running unittests src/lib.rs (target/debug/deps/community_notes-341177214784ea2e)
test result: ok. 24 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.12s
   Doc-tests community_notes
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
```

The sandbox test deploys the release WASM to a local nearcore sandbox and
calls it as the Wallet does (30 Tgas, no deposit). First build the WASM:

```bash
(cd speak-to-sign/community-notes && ./build.sh 2>&1 | tail -3)
```

Expected on the computer that deployed the contract:

```text
res/community_notes.wasm
size:    169267 bytes
sha256:  472d1eaa420b22d71439bf2db341a45d59ba9aa63b094e758e9a3af3a561a253
```

On another computer the hash can be different: the WASM holds the local
source paths of panic locations.

```bash
(cd speak-to-sign/community-notes && cargo test -p community-notes-sandbox 2>&1 | grep -E 'Running|Doc-tests|test result|^test')
```

Expected:

```text
     Running unittests src/lib.rs (target/debug/deps/community_notes_sandbox-0384b741abce45f1)
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
     Running tests/sandbox.rs (target/debug/deps/sandbox-22e3bc6f6ae3ec0d)
test community_notes_in_the_sandbox ... ok
test get_notes_with_50_of_the_largest_notes ... ok
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 21.26s
   Doc-tests community_notes_sandbox
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
```

### 5. Live testnet facts

These are read-only NEAR RPC views. Define a helper first:

```bash
view() { curl -s https://rpc.testnet.near.org -H 'Content-Type: application/json' -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"query\",\"params\":{\"request_type\":\"call_function\",\"finality\":\"final\",\"account_id\":\"$1\",\"method_name\":\"$2\",\"args_base64\":\"$(printf '%s' "$3" | base64 | tr -d '\n')\"}}" | jq -r '.result.result | implode'; }
```

Spoken notes came in verifier 0.4.0, version `8a0b7ba0…` of the OutLayer
project `seams-v1.testnet/voice-verifier`:

```bash
view outlayer.testnet get_version '{"project_id":"seams-v1.testnet/voice-verifier","version_key":"8a0b7ba0dff61a4b45e5d1d164c011525e11fe9f4fd02a4e22368882447329ef"}' | jq -c '{wasm_hash, is_active, url: .source.WasmUrl.url}'
```

Expected:

```text
{"wasm_hash":"8a0b7ba0dff61a4b45e5d1d164c011525e11fe9f4fd02a4e22368882447329ef","is_active":false,"url":"https://test.fastfs.io/seams-v1.testnet/outlayer.testnet/8a0b7ba0dff61a4b45e5d1d164c011525e11fe9f4fd02a4e22368882447329ef.wasm"}
```

The WASM at that URL has that SHA-256:

```bash
curl -sL https://test.fastfs.io/seams-v1.testnet/outlayer.testnet/8a0b7ba0dff61a4b45e5d1d164c011525e11fe9f4fd02a4e22368882447329ef.wasm | shasum -a 256
```

Expected:

```text
8a0b7ba0dff61a4b45e5d1d164c011525e11fe9f4fd02a4e22368882447329ef  -
```

The active version, which a caller gets when it sets no `version_key`, is
`d078eb11…`. It is verifier 0.4.1, the source on this branch, added on
2026-11-09 at 12:23 UTC. It keeps the note and rating rules of 0.4.0 and
forgives more words in a spoken transfer.

```bash
view outlayer.testnet get_project '{"project_id":"seams-v1.testnet/voice-verifier"}' | jq -c '{owner, active_version}'
```

Expected:

```text
{"owner":"seams-v1.testnet","active_version":"d078eb11eee0f11c5cc72d1284885b13ef5212a0862be123d1d43a3a5e83d54c"}
```

```bash
view outlayer.testnet get_version '{"project_id":"seams-v1.testnet/voice-verifier","version_key":"d078eb11eee0f11c5cc72d1284885b13ef5212a0862be123d1d43a3a5e83d54c"}' | jq -c '{wasm_hash, is_active, added_at}'
```

Expected:

```text
{"wasm_hash":"d078eb11eee0f11c5cc72d1284885b13ef5212a0862be123d1d43a3a5e83d54c","is_active":true,"added_at":1794227029277031521}
```

The notes contract `notes.seams-v1.testnet` answers `get_notes`. Note 1 is
the smoke test of the deployment, sent from the NEAR CLI and not spoken. It
is on post 9999, which is not a demo post:

```bash
view notes.seams-v1.testnet get_notes '{"post_id":9999}' | jq -c '.[] | {id, author, summary, status}'
```

Expected:

```text
{"id":1,"author":"seams-v1.testnet","summary":"Smoke test after deploy","status":"needs_more_ratings"}
```

The demo page shows posts 1 to 5. On 2026-11-09 they have no notes yet:

```bash
for p in 1 2 3 4 5; do view notes.seams-v1.testnet get_notes "{\"post_id\":$p}"; done
```

Expected on 2026-11-09 (a spoken note from the demo appears here later):

```text
[]
[]
[]
[]
[]
```

The deployed code is the release WASM of step 4. The code hash is the
base58 form of its SHA-256 `472d1eaa…`:

```bash
curl -s https://rpc.testnet.near.org -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"query","params":{"request_type":"view_account","finality":"final","account_id":"notes.seams-v1.testnet"}}' | jq -r .result.code_hash
```

Expected:

```text
5nqrLnLpoZrtxbMQQKFB9CoowyEXJ9notqsHe51dBjPY
```

### What needs a microphone

Enrollment (three recordings of the owner) and a spoken note or rating need a
person, a passkey and a microphone. The demo video shows them. To try them,
run the demo page (`demo/README.md`).

## Baseline and hackathon work

The hackathon window runs from 2026-10-19 to 2026-11-14 (UTC). Seams Wallet
existed before the window; it is the baseline. All of this repository was
made in the window. The table gives the first commit of each part in UTC
author time.

Define a helper that prints the first commit that added a path:

```bash
first() { TZ=UTC git -C "$1" log --diff-filter=A --reverse --date=format-local:'%Y-%m-%d %H:%M' --format='%ad UTC %h %s' -- "$2" | head -1 | cut -c1-100; }
```

| Part | Where | First commit | Command |
| ---- | ----- | ------------ | ------- |
| **Baseline.** Seams Wallet with Router A/B threshold signing, ed25519-yao and threshold ECDSA. Parts are checked with Lean, Verus and TLA+. | `seams-wallet`: `crates/router-ab-*`, `crates/ed25519-yao`, `crates/*/formal-verification` | 2026-09-11 17:10, `cdb1c4a1` | `first seams-wallet crates/ed25519-yao` |
| **Baseline.** VoiceID UI scaffold: a voice assistant card with no speech check. | `seams-wallet`: `packages/wallet/src/react/components/VoiceAssistantCard.tsx` (removed later) | 2026-10-13 03:28, `21503882` | `first seams-wallet packages/wallet/src/react/components/VoiceAssistantCard.tsx` |
| Window starts. The last earlier commit on `seams-wallet` `main` is `620794d9`. | | 2026-10-18 23:54 | `TZ=UTC git -C seams-wallet log -1 --before=2026-10-19T00:00:00Z --date=format-local:'%Y-%m-%d %H:%M' --format='%cd UTC %h %s'` |
| VoiceID speech verification. | `seams-wallet`: commits that name VoiceID; `packages/voiceid` from 2026-10-26 | 2026-10-22 16:36, `9ace901f` | `TZ=UTC git -C seams-wallet log -i --grep=voiceid --reverse --date=format-local:'%Y-%m-%d %H:%M' --format='%ad UTC %h %s' \| sed -n 2p` |
| The `spoken-intent` crate. It moved here from `seams-wallet` `crates/spoken-intent` with its history. | `speak-to-sign`: `spoken-intent/` | 2026-11-07 06:50, `923e576` | `first speak-to-sign spoken-intent` |
| The verifier, the speaker service and the Gate 0 probes. | `speak-to-sign`: `voice-verifier/`, `speaker-service/`, `gate0/`, `voice-probe/` | 2026-11-07 12:21, `6e5abf1` | `first speak-to-sign voice-verifier` |
| Speak-to-Sign in the Wallet. | `seams-wallet`: `packages/speak-to-sign` (now `packages/speak-to-sign/` here, with its history), `packages/wallet/src/core/transactionFeatures/` | 2026-11-07 12:20, `4b0d7981` | `first seams-wallet packages/speak-to-sign` |
| Spoken notes in the verifier (version 0.4.0). | `speak-to-sign`: `voice-verifier/src` | 2026-11-09 10:14, `ff1409b` | `TZ=UTC git -C speak-to-sign log -S community_note --reverse --date=format-local:'%Y-%m-%d %H:%M' --format='%ad UTC %h %s' -- voice-verifier/src \| head -1` |
| The community notes contract. | `speak-to-sign`: `community-notes/` | 2026-11-09 10:21, `7f0e014` | `first speak-to-sign community-notes` |
| Spoken notes in the Wallet. | `seams-wallet`: `packages/wallet/src` | 2026-11-09 10:25, `bec40080` | `TZ=UTC git -C seams-wallet log -S add_note --reverse --date=format-local:'%Y-%m-%d %H:%M' --format='%ad UTC %h %s' -- packages/wallet/src \| head -1` |
| The Spoken Notes demo page. | `speak-to-sign`: `demo/` (an earlier Python demo client is from 2026-11-07) | 2026-11-09 10:33, `e25f1ec` | `TZ=UTC git -C speak-to-sign log -1 --date=format-local:'%Y-%m-%d %H:%M' --format='%ad UTC %h %s' e25f1ec` |
| The Speak to pay example. | `speak-to-sign`: `examples/` | 2026-11-09 11:05, `2999fd6` | `first speak-to-sign examples` |

The diffs:

- This repository: every commit of the `speak-to-sign` branch is in the window
  (<https://github.com/seams-tech/speak-to-sign/commits/speak-to-sign>). The
  oldest commit:

  ```bash
  TZ=UTC git -C speak-to-sign log --date=format-local:'%Y-%m-%d %H:%M' --format='%ad UTC %h %s' | sort | head -1 | cut -c1-100
  ```

  Expected:

  ```text
  2026-11-07 06:50 UTC 923e576 Add the spoken-intent crate for Refactor 210 voice intents: one no_std 
  ```
- `seams-wallet`, all changes in the window:
  <https://github.com/seams-tech/seams-wallet/compare/620794d9187c005e266292aea4d5b61a31d4a4d9...b12cf643c293a9a042d3df56f5a3689e69cf8b33>.
  Most of these 632 commits are general Wallet work. The Speak-to-Sign paths
  are new files only:

  ```bash
  git -C seams-wallet diff --shortstat 620794d91 b12cf643c -- packages/voiceid packages/speak-to-sign packages/wallet/src/core/transactionFeatures crates/spoken-intent
  ```

  Expected:

  ```text
  91 files changed, 17110 insertions(+)
  ```

## Libraries, services and tools

- Own baseline: the Seams Wallet SDK (`@seams/wallet`) and its Router A/B
  signing. The SDK packages `@seams/voiceid` and `@seams/speak-to-sign` were
  made in the window (see the table).
- Rust: `near-sdk` 5.30.1, `near-workspaces` 0.24.0 (sandbox test only),
  `outlayer` 0.2.1, `wasi` 0.13.3, `ed25519-dalek` 2, `sha2` 0.10.9, `borsh`
  1.6.1, `serde`, `serde_json`, `base64`.
- Web: React 19, Vite 8, Wrangler 4 (Cloudflare Pages).
- Services: OutLayer (TEE workers, FastFS), NEAR AI Cloud (Whisper large-v3),
  Phala dstack CVM (ReDimNet B1 speaker embeddings), NEAR testnet RPC.
- AI coding agents (Claude Code and Codex) wrote parts of the code.

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
| `spoken-intent/`         | The `no_std` crate that renders a spoken request into canonical English, computes its request and spoken-text digests, and reads transcripts. Its golden vectors check the Wallet's TypeScript ports. |
| `voice-verifier/`        | The OutLayer worker: `enroll` and `verify`. See its README.        |
| `speaker-service/`       | ReDimNet speaker embeddings in a Phala dstack CVM, signed replies. |
| `gate0/`, `voice-probe/` | Gate 0 probes, the FastFS uploader and the HTTPS latency probe.    |
| `packages/speak-to-sign/` | `@seams/speak-to-sign`, the optional Speak-to-Sign plugin for a Seams Wallet host. It moved here from `seams-wallet` with its history. |
| `community-notes/`       | The NEAR contract `notes.seams-v1.testnet`: `add_note`, `rate_note` and the views. See its README. |
| `demo/`                  | The Spoken Notes demo page: post and rate community notes by voice. See its README. |
| `examples/seams-voice-intents/` | Seams Voice Intents: a web page that pays a NEAR testnet account by voice. See its README. |
| `docs/`                  | The record of the screener commands and their outputs.             |

## Testnet facts

| Item                | Value                                                                                        |
| ------------------- | -------------------------------------------------------------------------------------------- |
| Verifier            | `seams-v1.testnet/voice-verifier`, version 0.4.1, `d078eb11eee0f11c5cc72d1284885b13ef5212a0862be123d1d43a3a5e83d54c`, active since 2026-11-09 12:23 UTC. Notes and ratings as in 0.4.0; a more forgiving word check for transfers. |
| Verifier with notes | version 0.4.0, `8a0b7ba0dff61a4b45e5d1d164c011525e11fe9f4fd02a4e22368882447329ef`, added 2026-11-09 and not active (FastFS tx `GPzHTAuC2VADuGR46ks7Mij8oPcZ4xVW9h7VuEkyqfuh`, `add_version` tx `9k7qWvG1JcCVyfzRjWjbWsjdK5MjXwQQ7vh71rT8me7y`). It adds `community_note` and `note_rating`; transfers are unchanged. A caller selects it by `version_key`. |
| Earlier verifier    | version 0.3.1, `5b6fad5df11440847e13508f57736da8de371526824cf12178dfc20be2c9c1d1`, transfers only, not active. |
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
