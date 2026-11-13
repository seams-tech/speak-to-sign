# Check it from a terminal

This is the long form of the checks in
[`JUDGES.md`](../JUDGES.md#check-it-from-a-terminal): each command, with the
whole output that it prints.

To try the voice flow, open the demo site on a laptop with a microphone.
These steps check the rest from a terminal, with no NEAR account and no keys.
They run the tests that hold the binding rules, and they read the live
testnet state. Each
expected output below comes from a run on 2026-11-12 on macOS 15.7.1 (arm64)
with rustc 1.97.1, Node 24.18.0, pnpm 11.11.0 and jq 1.7.1, in a fresh clone
of `dev`. Times, the order of test lines, and the hashes in
`target/debug/deps/` paths can be different on your computer.

You need:

- `git`, `curl`, `jq` and `shasum` (on Linux, `sha256sum` gives the same hash).
- Rust from rustup. `demo/contracts/community-notes/` pins Rust 1.97.0 with the
  `wasm32-unknown-unknown` target; rustup installs it on the first `cargo` call.
- Node 24 and pnpm 11. `corepack enable` gives the pnpm version that the
  packages pin.
- Network access. The sandbox test downloads a nearcore sandbox binary on its
  first run.
- For the reproducible build of step 4 only: Docker and cargo-near 0.22.0.

Run every command from the `speak-to-sign-check` folder that step 0 makes.

## 0. Get the code

```bash
mkdir speak-to-sign-check && cd speak-to-sign-check
```

```bash
git clone https://github.com/seams-tech/speak-to-sign
```

This repository is all that you need. Seams Wallet is a dependency from npm
(`@seams/wallet`), and its repository is not part of these steps. Use a full
clone (no `--depth`), because the dates in [`hackathon-scope.md`](hackathon-scope.md) come from
the history.

## 1. The sentence and the signed bytes

The main claim is that the words you say are the call that gets signed. The
`spoken-intent` crate makes both from one request: the English sentence, and
the digest that the verdict binds. This test proves that the two stay
together: 37 fixed requests, each with its sentence and its digest, in
`fixtures/spoken_intent_vectors_v1.json`. If the code makes another sentence
or another digest for one of them, the test fails.

```bash
# See: 9 "ok" lines, 39 passed.
(cd speak-to-sign/crates/spoken-intent && cargo test 2>&1 | grep 'test result')
```

Step 3 checks the digest of each of these requests again, in TypeScript.

## 2. The verifier

```bash
(cd speak-to-sign/crates/voice-verifier && cargo test 2>&1 | grep -E 'Running|Doc-tests|test result')
```

Expected (140 tests). The 16-digit hex suffix of each verifier test binary
depends on the folder of your clone, so yours can differ; the test names and
counts do not.

```text
     Running unittests src/lib.rs (target/debug/deps/seams_voice_verifier-2d5b7edcafc2248c)
test result: ok. 53 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.33s
     Running unittests src/main.rs (target/debug/deps/seams_voice_verifier-90ff6f1c87da1f08)
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
     Running tests/detect_live.rs (target/debug/deps/detect_live-380b27f77660075d)
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
     Running tests/enrollment_vectors.rs (target/debug/deps/enrollment_vectors-d105d7cc1e84ceb8)
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
     Running tests/ops/main.rs (target/debug/deps/ops-ed4a686ad062a087)
test result: ok. 81 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.70s
     Running tests/signed_intent_vector.rs (target/debug/deps/signed_intent_vector-c299357e8f904bdf)
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
     Running tests/signed_transcript_vector.rs (target/debug/deps/signed_transcript_vector-b50544f54788ca35)
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
     Running tests/signed_vector.rs (target/debug/deps/signed_vector-f21b9e98197b8f11)
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
   Doc-tests seams_voice_verifier
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
```

The note tests are in `tests/ops/notes.rs`. They run the real `verify` operation
with a fake host. The fake host has an enrolled owner and returns the given
transcript. Each test checks the ed25519 signature of the verdict.

```bash
(cd speak-to-sign/crates/voice-verifier && cargo test --test ops notes:: 2>&1 | grep -E '^test')
```

Expected (in any order):

```text
test notes::a_rating_has_no_summary_check ... ok
test notes::a_note_is_not_signed_without_the_answer_of_jev ... ok
test notes::the_words_are_checked_before_the_summary ... ok
test notes::a_note_is_signed_only_if_its_summary_gives_its_main_point ... ok
test notes::verify_accepts_a_spoken_rating_with_exact_words ... ok
test notes::note_inputs_that_are_not_speakable_are_unsupported ... ok
test notes::verify_accepts_a_spoken_note_summary ... ok
test result: ok. 7 passed; 0 failed; 0 ignored; 0 measured; 74 filtered out; finished in 0.93s
```

From verifier 0.13.0, the verifier also asks JEV whether the summary gives
the main point of the note, after the word check. Four of these tests check
that rule: a note is not signed without the answer of JEV, or with a summary
that misses the main point, and a rating has no summary check.

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

## 3. The verdict check

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

Expected (56 tests in all):

```text
✔ a step-up verdict passes only on request
✔ a verdict for another request or another recording
✔ a verdict of another renderer
✔ a verdict that expires further ahead than one life is not yet valid
✔ a verdict for another sentence
✔ a verdict for one community note does not pass for another note
ℹ pass 56
ℹ fail 0
```

"A verdict for one community note does not pass for another note" signs a
verdict for the `community_note` request of the golden file. The check passes
for that note, and gives `request_mismatch` for the
`community_note_one_word` note. Wallet core refuses such a verdict with
`{ kind: 'refused', reason: 'verdict_mismatch', detail: 'request_digest differs' }`
and signs nothing. With the verdict of the note, core signs one transaction:
`add_note` on the notes contract with the note's `post_id`, `text` and
`summary`, the `verdict_json` and `signature_b64` of the verdict, 30 Tgas and
a deposit of `0`. That code is in the Wallet, the dependency (0.70.1):
`signNoteWithVerdict` in
[`packages/wallet/src/core/transactionFeatures/hostOperations.ts`](https://github.com/seams-tech/seams-wallet/blob/26e42d3562ba7897ef891c6cad722ac1686e2956/packages/wallet/src/core/transactionFeatures/hostOperations.ts#L197),
and its test in
[`tests/unit/speakToSignHost.unit.test.ts`](https://github.com/seams-tech/seams-wallet/blob/26e42d3562ba7897ef891c6cad722ac1686e2956/tests/unit/speakToSignHost.unit.test.ts#L1168).

## 4. The notes contract

Unit tests, one for each rule of the contract:

```bash
(cd speak-to-sign/demo/contracts/community-notes && cargo test -p community-notes 2>&1 | grep -E 'Running|Doc-tests|test result')
```

Expected:

```text
     Running unittests src/lib.rs (target/debug/deps/community_notes-b56739b945cc4dd3)
test result: ok. 47 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.21s
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
cargo-near 0.22.0, and takes 1 to 2.5 minutes. `reproducible.sh check`
builds the commit that `reproducible.sha256` names (`119ef0e`, the deployed
build):

```bash
(cd speak-to-sign/demo/contracts && ./reproducible.sh check community-notes 2>/dev/null | tail -5)
```

Expected:

```text
community-notes
commit    119ef0e6ceda8fedd131a8b4a7e6ce554b99751f
recorded  596beeb36aa2a43eccc211e9dcc557b992d19fcd72e3ef8fcfeb9d5aa237d9c3
built     596beeb36aa2a43eccc211e9dcc557b992d19fcd72e3ef8fcfeb9d5aa237d9c3
result    same bytes
```

`demo/contracts/README.md` describes the build of all four contracts.

```bash
(cd speak-to-sign/demo/contracts/community-notes && cargo test -p community-notes-sandbox 2>&1 | grep -E 'Running|Doc-tests|test result|^test')
```

Expected:

```text
     Running unittests src/lib.rs (target/debug/deps/community_notes_sandbox-d9c0dab69a3ee091)
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
     Running tests/sandbox.rs (target/debug/deps/sandbox-706691a49c0d5fc4)
test the_moderator_hides_a_note ... ok
test spoken_notes_in_the_sandbox ... ok
test community_notes_in_the_sandbox ... ok
test get_notes_with_50_of_the_largest_notes ... ok
test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 21.05s
   Doc-tests community_notes_sandbox
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
```

## 5. Live testnet facts

These are read-only NEAR RPC views through FastNear. (The older endpoint
`rpc.testnet.near.org` is deprecated, and it answers HTTP 429 after a few
dozen calls.) Define a helper first:

```bash
view() { curl -s https://rpc.testnet.fastnear.com -H 'Content-Type: application/json' -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"query\",\"params\":{\"request_type\":\"call_function\",\"finality\":\"final\",\"account_id\":\"$1\",\"method_name\":\"$2\",\"args_base64\":\"$(printf '%s' "$3" | base64 | tr -d '\n')\"}}" | jq -r '.result.result | implode'; }
```

Spoken notes came in verifier 0.4.0, version `8a0b7ba0…` of the OutLayer
project `seams-v1.testnet/voice-verifier`. The owner removed that version
from the project on 2026-11-12, with the other versions that no caller used.
So the view finds no version:

```bash
view outlayer.testnet get_version '{"project_id":"seams-v1.testnet/voice-verifier","version_key":"8a0b7ba0dff61a4b45e5d1d164c011525e11fe9f4fd02a4e22368882447329ef"}' | jq -c '{wasm_hash, is_active, url: .source.WasmUrl.url}'
```

Expected:

```text
{"wasm_hash":null,"is_active":null,"url":null}
```

The WASM of that version is still on FastFS, with that SHA-256:

```bash
curl -sL https://test.fastfs.io/seams-v1.testnet/outlayer.testnet/8a0b7ba0dff61a4b45e5d1d164c011525e11fe9f4fd02a4e22368882447329ef.wasm | shasum -a 256
```

Expected:

```text
8a0b7ba0dff61a4b45e5d1d164c011525e11fe9f4fd02a4e22368882447329ef  -
```

The active version, which a caller gets when it sets no `version_key`, is
`1e7c6968…`, verifier 0.14.1, since 2026-11-12 (`set_active_version` tx
`GnXazq3d4UukDyGMm6FPGoCvrCEQhwniHKGAMr8vc6rC`). Before, 0.12.0 (`bfe81633…`) was
active from 2026-11-11, and 0.14.1+venice for some minutes on 2026-11-12.

```bash
view outlayer.testnet get_project '{"project_id":"seams-v1.testnet/voice-verifier"}' | jq -c '{owner, active_version}'
```

Expected:

```text
{"owner":"seams-v1.testnet","active_version":"1e7c6968bbfcf6d3193874d12988054114a004f7e10ccf8c1aeddfdca6d38a5c"}
```

```bash
view outlayer.testnet get_version '{"project_id":"seams-v1.testnet/voice-verifier","version_key":"1e7c6968bbfcf6d3193874d12988054114a004f7e10ccf8c1aeddfdca6d38a5c"}' | jq -c '{wasm_hash, is_active, added_at}'
```

Expected:

```text
{"wasm_hash":"1e7c6968bbfcf6d3193874d12988054114a004f7e10ccf8c1aeddfdca6d38a5c","is_active":true,"added_at":1794512550592416147}
```

jq 1.6 rounds the large number of `added_at`.

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

Posts 1 to 5 were the demo posts until the page moved to X posts (the
"Signed by voice" list of the page links the spoken notes on chain). Posts 1
to 5 have no notes:

```bash
for p in 1 2 3 4 5; do view notes.seams-v1.testnet get_notes "{\"post_id\":$p}"; done
```

Expected:

```text
[]
[]
[]
[]
[]
```

The deployed code is the reproducible build of `119ef0e` that step 4 checks,
since the redeploy of 2026-11-12 (see "Testnet deployment" in
`demo/contracts/community-notes/README.md`). The code hash is the base58 form
of the SHA-256 `596beeb3…d9c3` that step 4 builds again:

```bash
curl -s https://rpc.testnet.fastnear.com -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"query","params":{"request_type":"view_account","finality":"final","account_id":"notes.seams-v1.testnet"}}' | jq -r .result.code_hash
```

Expected:

```text
724jz1XPE5sEQU8HXMXf4Ub1WWem8csJyhAKSeabtU7c
```

The deployed code names its commit (NEP-330):

```bash
view notes.seams-v1.testnet contract_source_metadata '{}' | jq -r .build_info.source_code_snapshot
```

Expected:

```text
git+https://github.com/seams-tech/speak-to-sign?rev=119ef0e6ceda8fedd131a8b4a7e6ce554b99751f
```

The note market and the faucet run the reproducible builds of commit
`777b844`, and the voice multisig runs the build of `99231f6` (see
`demo/contracts/README.md`).

## What needs a microphone

Enrollment (three recordings of the owner) and a spoken note, rating or bet
need a person, a passkey and a microphone. The demo video shows them. To try
them, open <https://speak-to-sign.pages.dev/>, or run the demo page
yourself (`demo/frontend/README.md`).

