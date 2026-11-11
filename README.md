# Speak to Sign

Speak-to-Sign lets the owner of a NEAR account approve one exact call with
their own voice. The hackathon demo is community notes on an X-style page.
Testnet only.

Judges: [`JUDGES.md`](JUDGES.md) is the short path to see it work and to
check each claim.

1. You type a community note on a post. To post it, you read a short summary of the note aloud.
2. An attested verifier checks the audio: an OutLayer TEE worker, NEAR AI Whisper for the words and ReDimNet on Phala for the speaker.
3. The verifier signs a verdict. The verdict binds the speaker and the heard words to the exact note: the SHA-256 of the note text, the post, the contract and the owner. For a rating, it binds the note id and the rating.
4. Seams Wallet core checks the verdict against a pinned key. Then it signs `add_note` (or `rate_note`) on `notes.seams-v1.testnet` from the owner's own account.
5. Wallet core refuses a verdict for another note or another summary. The verifier refuses spoken words that add or drop a "not".

**Why sign by voice?**

- **Each note needs the owner's voice.** You read the summary of each note
  aloud, and the verifier compares the voice with the voice that the owner
  enrolled. A bot cannot post a note without that voice. A good clone can
  still pass: this build has no liveness check (see [Trust limits](#trust-limits)).
- **No blind signing.** A passkey click shows that a device approved
  something, not what the person agreed to. Here the Wallet signs only when
  the spoken words match the request, so the words of a phishing request do
  not match.
- **One sentence is the approval.** The verifier signs a verdict that binds
  the voice, the heard words and the request. Wallet core signs only with
  that verdict, so one spoken sentence is both the check of the person and
  the approval of the call.

| Item        | Link                                                    |
| ----------- | ------------------------------------------------------- |
| Demo video  | TODO: the owner adds the link to the demo video.        |
| X post      | TODO: the owner adds the link to the X post.            |
| Demo page   | `demo/frontend/README.md` tells how to run it and what must be live. |
| Contracts   | [Testnet facts](#contracts): the four contract accounts, with NearBlocks links. |

The same verifier also approves spoken NEAR transfers
(`examples/speak-to-pay/`).

## Reproduce without a microphone

These steps need no microphone, no NEAR account and no keys. They run the
tests that hold the binding rules, and they read the live testnet state. Each
expected output below comes from a run on 2026-11-09 on macOS 15.7.1 (arm64)
with rustc 1.97.1, Node 24.18.0 and pnpm 11.11.0. Times, and the hashes in
`target/debug/deps/` paths, can be different on your computer.

You need:

- `git`, `curl`, `jq` and `shasum` (on Linux, `sha256sum` gives the same hash).
- Rust from rustup. `demo/contracts/community-notes/` pins Rust 1.97.0 with the
  `wasm32-unknown-unknown` target; rustup installs it on the first `cargo` call.
- Node 24 and pnpm 11. `corepack enable` gives the pnpm version that the
  packages pin.
- Network access. The sandbox test downloads a nearcore sandbox binary on its
  first run.

Run every command from the `speak-to-sign-check` folder that step 0 makes.

### 0. Get the code

```bash
mkdir speak-to-sign-check && cd speak-to-sign-check
```

```bash
git clone https://github.com/seams-tech/speak-to-sign
```

This repository is all that you need. Seams Wallet is a dependency from npm
(`@seams/wallet`), and its repository is not part of these steps. Use a full
clone (no `--depth`), because the dates in "Baseline and hackathon work" come
from the history.

### 1. Spoken-intent golden vectors

The `spoken-intent` crate renders a request into the one English sentence
that the owner says. It also computes the request digest that the verdict
binds. `fixtures/spoken_intent_vectors_v1.json` is the golden file: 24
requests (12 transfers, 6 multisig approvals, 3 community notes, 3 note
ratings), with their sentences, Borsh bytes and digests, plus the vectors for
normalization, transcript parsing and sound-alike words.

```bash
(cd speak-to-sign/crates/spoken-intent && cargo test 2>&1 | grep -E 'Running|Doc-tests|test result')
```

Expected (27 tests):

```text
     Running unittests src/lib.rs (target/debug/deps/spoken_intent-a16e3c61734de2f2)
test result: ok. 10 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
     Running tests/accounts.rs (target/debug/deps/accounts-01376625692ffcf7)
test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
     Running tests/normalize.rs (target/debug/deps/normalize-cfb59b3220c05961)
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
     Running tests/punctuated.rs (target/debug/deps/punctuated-679c9bdf9b6ce233)
test result: ok. 8 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
     Running tests/render.rs (target/debug/deps/render-4db1d85cafcf77f4)
test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
     Running tests/vectors.rs (target/debug/deps/vectors-21056aa4746d8cc3)
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.02s
   Doc-tests spoken_intent
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
```

`committed_spoken_intent_vectors_match_generator` (in `tests/vectors.rs`)
fails if the committed golden file differs from what the code generates.

Step 3 checks the request digest of every vector of this file again, in
TypeScript.

### 2. The verifier

```bash
(cd speak-to-sign/crates/voice-verifier && cargo test 2>&1 | grep -E 'Running|Doc-tests|test result')
```

Expected (63 tests). The 16-digit hex suffix of each verifier test binary
depends on the folder of your clone, so yours can differ; the test names and
counts do not.

```text
     Running unittests src/lib.rs (target/debug/deps/seams_voice_verifier-295e294e9723da61)
test result: ok. 37 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s
     Running unittests src/main.rs (target/debug/deps/seams_voice_verifier-159a9fbb1adef904)
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
     Running tests/enrollment_vectors.rs (target/debug/deps/enrollment_vectors-f91d633521215fb8)
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
     Running tests/ops/main.rs (target/debug/deps/ops-1be840971268f48f)
test result: ok. 23 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.97s
     Running tests/signed_vector.rs (target/debug/deps/signed_vector-356786a2eeb0f383)
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
   Doc-tests seams_voice_verifier
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
```

The note tests are in `tests/ops/notes.rs`. They run the real `verify` operation
with a fake host. The fake host has an enrolled owner and returns the given
transcript. Each test checks the ed25519 signature of the verdict.

```bash
(cd speak-to-sign/crates/voice-verifier && cargo test --test ops -- note rating 2>&1 | grep -E '^test')
```

Expected:

```text
test notes::note_inputs_that_are_not_speakable_are_unsupported ... ok
test notes::verify_accepts_a_spoken_rating_with_exact_words ... ok
test notes::verify_accepts_a_spoken_note_summary ... ok
test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 20 filtered out; finished in 0.82s
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
The rule is `words_pass` in `crates/voice-verifier/src/words.rs`.

### 3. The verdict check

`@seams/voice-verdict` (`packages/voice-verdict/`) checks a signed verdict
before anything is signed. Any application can call its `checkVerdict`. It
checks the pinned key, the signature, the fields, the expiry, and that the
verdict binds the request and the sentence that the signer built itself.

Seams Wallet core and the Seams co-signer call `checkVerdict` from Seams
Wallet 0.67.0 (`@seams/wallet` and `@seams/wallet-server`, merge
[`bb2014e1`](https://github.com/seams-tech/seams-wallet/commit/bb2014e1f)). An
earlier Wallet has its own copy of the check.

```bash
(cd speak-to-sign/packages/voice-verdict && pnpm install --frozen-lockfile >/dev/null && pnpm test 2>&1 | grep -E '^✔ a (step-up |verdict)|^ℹ (pass|fail)' | sed 's/ ([0-9.]*ms)//')
```

Expected (51 tests in all):

```text
✔ a step-up verdict passes only on request
✔ a verdict for another request or another recording
✔ a verdict of another renderer
✔ a verdict that expires further ahead than one life is not yet valid
✔ a verdict for another sentence
✔ a verdict for one community note does not pass for another note
ℹ pass 51
ℹ fail 0
```

"A verdict for one community note does not pass for another note" signs a
verdict for the `community_note` request of the golden file. The check passes
for that note, and gives `request_mismatch` for the
`community_note_one_word` note. Wallet core refuses such a verdict with
`{ kind: 'refused', reason: 'verdict_mismatch', detail: 'request_digest differs' }`
and signs nothing. With the verdict of the note, core signs one transaction:
`add_note` on the notes contract with the note's `post_id`, `text` and
`summary`, 30 Tgas and a deposit of `0`. That code is in the Wallet, the
dependency: `signNoteWithVerdict` in
[`packages/wallet/src/core/transactionFeatures/hostOperations.ts`](https://github.com/seams-tech/seams-wallet/blob/dev/packages/wallet/src/core/transactionFeatures/hostOperations.ts).

### 4. The notes contract

Unit tests, one for each rule of the contract:

```bash
(cd speak-to-sign/demo/contracts/community-notes && cargo test -p community-notes 2>&1 | grep -E 'Running|Doc-tests|test result')
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
(cd speak-to-sign/demo/contracts/community-notes && ./build.sh 2>&1 | tail -3)
```

It prints the size and the SHA-256 of the WASM. This quick build is not the
same on another computer: the WASM holds the local source paths of panic
locations. For the same bytes on any computer, check the reproducible build
(`cargo near build reproducible-wasm`, NEP-330). It needs Docker and
cargo-near, and takes 1 to 2.5 minutes:

```bash
(cd speak-to-sign/demo/contracts && ./reproducible.sh check community-notes 2>/dev/null | tail -5)
```

Expected:

```text
community-notes
commit    777b84429096604e77e217480e9f89a398f5da13
recorded  0b821a5c459d31b7aed4b6459b3aa572189c927411878665d8eae633d51f7f80
built     0b821a5c459d31b7aed4b6459b3aa572189c927411878665d8eae633d51f7f80
result    same bytes
```

`demo/contracts/README.md` describes the build of all four contracts.

```bash
(cd speak-to-sign/demo/contracts/community-notes && cargo test -p community-notes-sandbox 2>&1 | grep -E 'Running|Doc-tests|test result|^test')
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
`bfe81633…`, verifier 0.12.0, since 2026-11-11 (`set_active_version` tx
`HBL4Uk7z4gwVDRJ8CncSsSe2YrXx85moYc7kvfYzHERc`). Before, 0.11.0 and, until
2026-11-11, 0.5.2 (`96b79b51…`) were active.

```bash
view outlayer.testnet get_project '{"project_id":"seams-v1.testnet/voice-verifier"}' | jq -c '{owner, active_version}'
```

Expected:

```text
{"owner":"seams-v1.testnet","active_version":"bfe81633b9ed596df239201f153a84c860d71ddd8edf713c1c785ef2b7c1c946"}
```

```bash
view outlayer.testnet get_version '{"project_id":"seams-v1.testnet/voice-verifier","version_key":"bfe81633b9ed596df239201f153a84c860d71ddd8edf713c1c785ef2b7c1c946"}' | jq -c '{wasm_hash, is_active, added_at}'
```

Expected:

```text
{"wasm_hash":"bfe81633b9ed596df239201f153a84c860d71ddd8edf713c1c785ef2b7c1c946","is_active":true,"added_at":1794361644287580200}
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

The deployed code is the reproducible build of step 4, since the redeploy of
2026-11-11 (see "Testnet deployment" in
`demo/contracts/community-notes/README.md`). The code hash is the base58 form
of the SHA-256 `0b821a5c…7f80` that step 4 builds again:

```bash
curl -s https://rpc.testnet.near.org -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"query","params":{"request_type":"view_account","finality":"final","account_id":"notes.seams-v1.testnet"}}' | jq -r .result.code_hash
```

Expected:

```text
mvYopouU7PP9ZVbwzTJ6qUH8kDjEiMeP7TDENF9eUko
```

The deployed code names its commit (NEP-330):

```bash
view notes.seams-v1.testnet contract_source_metadata '{}' | jq -r .build_info.source_code_snapshot
```

Expected:

```text
git+https://github.com/seams-tech/speak-to-sign?rev=777b84429096604e77e217480e9f89a398f5da13
```

The other three demo contracts also run the reproducible builds of commit
`777b844` (see `demo/contracts/README.md`).

### What needs a microphone

Enrollment (three recordings of the owner) and a spoken note or rating need a
person, a passkey and a microphone. The demo video shows them. To try them,
run the demo page (`demo/frontend/README.md`).

## Baseline and hackathon work

The hackathon window runs from 2026-10-19 to 2026-11-14 (UTC). Seams Wallet
existed before the window; it is the baseline. All of this repository was
made in the window. The table gives the first commit of each part in UTC
author time.

For a part of this repository, the command prints its first commit. Define
this helper first:

```bash
first() { TZ=UTC git -C "$1" log --diff-filter=A --reverse --date=format-local:'%Y-%m-%d %H:%M' --format='%ad UTC %h %s' -- "$2" | head -1 | cut -c1-100; }
```

For a part of the Wallet, the dependency, the last column links the commit on
GitHub.

| Part | Where | First commit | Command or link |
| ---- | ----- | ------------ | ------- |
| **Baseline.** Seams Wallet with Router A/B threshold signing, ed25519-yao and threshold ECDSA. Parts are checked with Lean, Verus and TLA+. | `seams-wallet`: `crates/router-ab-*`, `crates/ed25519-yao`, `crates/*/formal-verification` | 2026-09-11 17:10, `cdb1c4a1` | [`cdb1c4a1`](https://github.com/seams-tech/seams-wallet/commit/cdb1c4a1) |
| **Baseline.** VoiceID UI scaffold: a voice assistant card with no speech check. | `seams-wallet`: `packages/wallet/src/react/components/VoiceAssistantCard.tsx` (removed later) | 2026-10-13 03:28, `21503882` | [`21503882`](https://github.com/seams-tech/seams-wallet/commit/21503882) |
| Window starts. The last earlier commit on `seams-wallet` `main` is `620794d9`. | | 2026-10-18 23:54 | [`620794d9`](https://github.com/seams-tech/seams-wallet/commit/620794d9) |
| VoiceID speech verification. | `seams-wallet`: commits that name VoiceID; `packages/voiceid` from 2026-10-26 | 2026-10-22 16:36, `9ace901f` | [`9ace901f`](https://github.com/seams-tech/seams-wallet/commit/9ace901f) |
| The `spoken-intent` crate. It moved here from `seams-wallet` `crates/spoken-intent` with its history. | `speak-to-sign`: `crates/spoken-intent/` (was `spoken-intent/`) | 2026-11-07 06:50, `923e576` | `first speak-to-sign spoken-intent` |
| The verifier, the speaker service and the Gate 0 probes. | `speak-to-sign`: `crates/voice-verifier/`, `crates/speaker-service/`, `research/gate0/` (was `voice-verifier/`, `speaker-service/`, `gate0/`, `voice-probe/`) | 2026-11-07 12:21, `6e5abf1` | `first speak-to-sign voice-verifier` |
| Speak-to-Sign in the Wallet. | `seams-wallet`: `packages/speak-to-sign` (later `packages/wallet-voice-sign/` here, and since refactor 232 a part of `@seams/wallet` again), `packages/wallet/src/core/transactionFeatures/` | 2026-11-07 12:20, `4b0d7981` | [`4b0d7981`](https://github.com/seams-tech/seams-wallet/commit/4b0d7981) |
| Spoken notes in the verifier (version 0.4.0). | `speak-to-sign`: `crates/voice-verifier/src` (was `voice-verifier/src`) | 2026-11-09 10:14, `ff1409b` | `TZ=UTC git -C speak-to-sign log -S community_note --reverse --date=format-local:'%Y-%m-%d %H:%M' --format='%ad UTC %h %s' -- voice-verifier/src \| head -1` |
| The community notes contract. | `speak-to-sign`: `demo/contracts/community-notes/` (was `community-notes/`, then `contracts/community-notes/`) | 2026-11-09 10:21, `7f0e014` | `first speak-to-sign community-notes` |
| Spoken notes in the Wallet. | `seams-wallet`: `packages/wallet/src` | 2026-11-09 10:25, `bec40080` | [`bec40080`](https://github.com/seams-tech/seams-wallet/commit/bec40080) |
| The Spoken Notes demo page. | `speak-to-sign`: `demo/frontend/` (was `demo/`; an earlier Python demo client is from 2026-11-07) | 2026-11-09 10:33, `e25f1ec` | `TZ=UTC git -C speak-to-sign log -1 --date=format-local:'%Y-%m-%d %H:%M' --format='%ad UTC %h %s' e25f1ec` |
| The Speak to pay example. | `speak-to-sign`: `examples/` | 2026-11-09 11:05, `2999fd6` | `first speak-to-sign examples` |
| The JEV prediction market for community notes: a parimutuel USDC market, the OutLayer resolver (JEV on NEAR AI), and the strip in the notes demo. | `speak-to-sign`: `demo/contracts/jev-prediction-market/`, `demo/frontend/src/market/` | 2026-11-09 15:11, `a6c2376` | `first speak-to-sign demo/contracts/jev-prediction-market` |

The diffs:

- This repository: every commit of the `dev` branch is in the window
  (<https://github.com/seams-tech/speak-to-sign/commits/dev>). The
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
  (`packages/voiceid`, `packages/speak-to-sign`,
  `packages/wallet/src/core/transactionFeatures` and `crates/spoken-intent`)
  are new files only: 91 files, 17,110 added lines.

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

From verifier 0.12.0 the audio is confidential: the device seals each
recording to a key that exists only inside the OutLayer TEE, and the servers
between them carry ciphertext. The diagram is
[section 9 of `docs/architecture.md`](docs/architecture.md#9-confidential-audio).

The specification is `docs/voice-intents-spec.md`. The diagrams are in
`docs/architecture.md`. Design and record:
`seams-wallet/docs/refactor-227-speak-to-sign-without-passkey.md` and
`seams-monorepo/docs/refactor-210-voice-intents.md`.

## Repository

Each top-level folder says what its contents are for.

| Folder | What it is |
| ------ | ---------- |
| `crates/spoken-intent/` | The `no_std` crate that renders a spoken request into canonical English, computes its request and spoken-text digests, and reads transcripts. Its golden vectors check the Wallet's TypeScript ports. |
| `crates/voice-verifier/` | The OutLayer worker: `enroll` and `verify`. `scripts/fastfs_chunks.py` splits its WASM for the FastFS upload. See its README. |
| `crates/speaker-service/` | ReDimNet speaker embeddings in a Phala dstack CVM, signed replies. |
| `packages/voice-sign/` | `@seams/voice-sign`, the library for an application with no wallet: record a sentence, call the verifier, check the verdict. It joins `voice-capture` and `voice-verdict`. |
| `packages/voice-capture/` | `@seams/voice-capture`: records one spoken sentence in the browser. |
| `packages/voice-verdict/` | `@seams/voice-verdict`: checks a signed verdict, a signed transcript and the TDX quote of a call, and seals a recording to the verifier (`sealAudio`). One dependency, the cipher `@noble/ciphers`. |
| `crates/voice-verdict/` | The verdict check in Rust, for a server or a contract. |
| `examples/voice-confirm/` | A Web2 page and server with no wallet: enroll a voice and confirm an action. |
| `demo/frontend/` | The Spoken Notes demo page: post and rate community notes by voice. See its README. |
| `demo/contracts/community-notes/` | The NEAR contract `notes.seams-v1.testnet` for the demo: `add_note`, `rate_note` and the views. See its README. |
| `demo/contracts/jev-prediction-market/` | The note market `pm-notes.seams-v1.testnet`: parimutuel bets in testnet USDC on a community note, resolved by JEV through OutLayer (`resolver/`), with a JEV-weighted payout. See its README. |
| `demo/contracts/voice-multisig/` | The voice multisig `multisig.seams-v1.testnet`: a visitor proposes a NEAR transfer or the hide of a note by voice, and two admins approve. The demo site has no page for it. See its README. |
| `demo/contracts/faucet/` | The faucet `seams-faucet.testnet`: 0.2 NEAR and 2 testnet USDC for a new account, once. See its README. |
| `examples/speak-to-pay/` | Speak to pay: a web page that pays a NEAR testnet account by voice, served at `/pay/` of the demo site. See its README. |
| `research/gate0/` | The Gate 0 feasibility probes and the HTTPS latency probe (`voice-probe/`). Evidence, not product. |
| `docs/` | The voice intents specification (`voice-intents-spec.md`) and the architecture diagrams (`architecture.md`). |

The code is under the Apache License 2.0 (`LICENSE`).

## Releases

`docs/release-0.66.0.md` is the state of the release of the three libraries
for an application with no wallet (`@seams/voice-verdict`,
`@seams/voice-capture`, `@seams/voice-sign`), and the steps that it needs.

## Testnet facts

### Contracts

Each contract runs the reproducible build of commit
[`777b844`](https://github.com/seams-tech/speak-to-sign/tree/777b84429096604e77e217480e9f89a398f5da13)
since 2026-11-11. SourceScan built each one again and got the same code hash.
The account link opens the contract page of NearBlocks, which shows the code
as verified.

| Contract | Testnet account | Source | Code hash (base58) |
| -------- | --------------- | ------ | ------------------ |
| Community notes | [`notes.seams-v1.testnet`](https://testnet.nearblocks.io/address/notes.seams-v1.testnet/contract) | [`demo/contracts/community-notes/`](demo/contracts/community-notes/) | `mvYopouU7PP9ZVbwzTJ6qUH8kDjEiMeP7TDENF9eUko` |
| Voice multisig | [`multisig.seams-v1.testnet`](https://testnet.nearblocks.io/address/multisig.seams-v1.testnet/contract) | [`demo/contracts/voice-multisig/`](demo/contracts/voice-multisig/) | `B38YGRGymzWML2WoNz2TLqLe5z1vmKc1wjcHYRCEUahh` |
| Note market | [`pm-notes.seams-v1.testnet`](https://testnet.nearblocks.io/address/pm-notes.seams-v1.testnet/contract) | [`demo/contracts/jev-prediction-market/`](demo/contracts/jev-prediction-market/) | `7qA3mFHgGa31dsUJ3BjdCuh8yHS8jnnS79aMNPmSnQ9Z` |
| Faucet | [`seams-faucet.testnet`](https://testnet.nearblocks.io/address/seams-faucet.testnet/contract) | [`demo/contracts/faucet/`](demo/contracts/faucet/) | `6d8BGwTR88jjFFaYEfhnTnLaQet2FmRE3d5DvYxefR2z` |

The deploy transactions and the way to build each contract again are in
[`demo/contracts/README.md`](demo/contracts/README.md#the-deployed-code).

### Other facts

| Item                | Value                                                                                        |
| ------------------- | -------------------------------------------------------------------------------------------- |
| Verifier            | `seams-v1.testnet/voice-verifier`, version 0.12.0, `bfe81633b9ed596df239201f153a84c860d71ddd8edf713c1c785ef2b7c1c946`, active since 2026-11-11 (`set_active_version` tx `HBL4Uk7z4gwVDRJ8CncSsSe2YrXx85moYc7kvfYzHERc`). All request kinds, application owners, `select`, `transcribe`, `detect` and sealed audio. Before it, 0.11.0 (`d2f8b630…d9f8`) was active on 2026-11-11, and 0.5.2 (`96b79b51…d7e5`) from 2026-11-09 17:04 UTC. The Wallet server and the demo routes each send their own `version_key`. |
| Verifier with notes | version 0.4.0, `8a0b7ba0dff61a4b45e5d1d164c011525e11fe9f4fd02a4e22368882447329ef`, added 2026-11-09 and not active (FastFS tx `GPzHTAuC2VADuGR46ks7Mij8oPcZ4xVW9h7VuEkyqfuh`, `add_version` tx `9k7qWvG1JcCVyfzRjWjbWsjdK5MjXwQQ7vh71rT8me7y`). It adds `community_note` and `note_rating`; transfers are unchanged. A caller selects it by `version_key`. |
| Verifier with multisig | version 0.6.1, `f56ba0e8942a5fcd1b2ed500bf9013953bccefb22b375c2830c2b0a01508e7cb`, added 2026-11-10 and not active (FastFS tx `7sWJVYsV1Fkdmq4sW1GDZRE47w89L64NJwfL38AoGh5Q`, `add_version` tx `81nFKGTvg2DBgcTW6YN2YfUF57qDS1bBcXsEK5qJCE51`). It reads "point" for "dot" and a left-out "dash" in a spoken multisig proposal. The voice multisig route selects it by `version_key`. Version 0.6.0, `566e8cbc874b92a805d84360e6bab5c4f1c5b4eb276b518a207142be06fefbc9`, added 2026-11-10 and not active (FastFS tx `5VUpXWs653GegtePhTHYsc4TRUgzEXP5cKC2ZUmg4V9M`, `add_version` tx `EZjs5T1yY859sb2moQkjHYeFyyh8qLrXycV11YdKyqb4`). It adds `multisig_propose` and `multisig_confirm`; the other kinds are unchanged. The voice multisig route used it until 0.6.1. |
| Earlier verifiers   | version 0.5.1, `cdb46fea7fab5afbb855e373674c80a9cd77170beb594579da28d754009e7258`, and version 0.4.1, `d078eb11eee0f11c5cc72d1284885b13ef5212a0862be123d1d43a3a5e83d54c`, not active. Version 0.3.1, `5b6fad5df11440847e13508f57736da8de371526824cf12178dfc20be2c9c1d1`, transfers only, not active. |
| HTTPS API           | `https://testnet-api.outlayer.ai/call/seams-v1.testnet/voice-verifier`                       |
| `secrets_ref`       | `{"profile":"main","account_id":"cyan-loong.testnet"}`                                       |
| Verdict key         | `ed25519:E8E53ydtc9LRvVz9xBCRrSzyBa5nh1gK1ts53Aoo751U` (bound to the project, pinned in the Wallet) |
| Note market         | `pm-notes.seams-v1.testnet` (see "Contracts"). Bets in testnet USDC (`3e2210e1…b8af`), at least 0.1 USDC. Market 9 is the demo post's context box (note 0), open until 18 Nov 2026 23:59 UTC. |
| Voice multisig      | `multisig.seams-v1.testnet` (see "Contracts"), deployed 2026-11-10 (tx `BcBCruDvJ5MCyDPxRKqm7BCCXgUuyr1NfmeFXXZg6Dwz`). A visitor proposes by voice (verifier 0.6.1); `admin-a.seams-v1.testnet` and `admin-b.seams-v1.testnet` approve by key. No cap. It replaces `team.seams-v1.testnet`, which had a cap of 0.05 NEAR. |
| Market resolver     | OutLayer project `seams-v1.testnet/pm-notes-resolver`, version `360beda42aab4479a0c1ad38ef0a06878ea1819abdba05b06cab3541589d223a`: JEV (`typesafe/jev-1.13`) on NEAR AI, then a NEAR AI chat model. |

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
