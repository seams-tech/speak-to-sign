# Screener commands: the run of 2026-11-09

This is the full output of the commands in "Reproduce without a microphone"
and "Baseline and hackathon work" in the root `README.md`. A script ran each
command word for word in a new, empty `speak-to-sign-check` folder.

| Item            | Value                                                       |
| --------------- | ----------------------------------------------------------- |
| Date            | 2026-11-09, between 12:00 and 12:30 UTC                     |
| Computer        | macOS 15.7.1 (Darwin 24.6.0), arm64                         |
| Tools           | rustc 1.97.1 (stable), Node 24.18.0, pnpm 11.11.0, jq, curl |
| `speak-to-sign` | branch `speak-to-sign` at `2b28082` (first block below)     |
| `seams-wallet`  | `b12cf643c` (Wallet SDK 0.59.0 on `main`), a full clone from GitHub |

Differences from the README:

- The `speak-to-sign` clone came from the local branch, because GitHub did
  not have these commits yet. The clone was made at `9051333`. Then
  `git pull` moved it to `2b28082`, which changed `spoken-intent/` and
  `voice-verifier/`. Steps 1, 2 and 4 and the dates ran again at `2b28082`.
  Steps 3 and 5 do not use the `speak-to-sign` code.
- Local folder paths in the output are shortened to `<check>`, the
  `speak-to-sign-check` folder.

Each block starts with the command (`$ ...`) and ends with the exit code of
the command. When a command ends in `grep`, the exit code is the exit code
of `grep`, not of `cargo`.

## 0. Get the code

```text
$ git clone --branch speak-to-sign <local speak-to-sign checkout> speak-to-sign && git -C speak-to-sign log -1 --format='%h %s' && git -C seams-wallet log -1 --format='%h %s'
Cloning into 'speak-to-sign'...
done.
9051333 Spoken Notes demo: a page card covers the Wallet's gap between the VoiceID card and the enrollment confirm
b12cf643 release: prepare Wallet SDK 0.59.0
exit 0
```

```text
$ git -C speak-to-sign log -1 --format='%h %s' && git -C seams-wallet log -1 --format='%h %s'
2b28082 spoken-intent: a note summary keeps "period", "dash", "oh" and "point" as said
b12cf643 release: prepare Wallet SDK 0.59.0
exit 0
```

## 1. Spoken-intent golden vectors

```text
$ (cd speak-to-sign/spoken-intent && cargo test 2>&1 | grep -E 'Running|Doc-tests|test result')
     Running unittests src/lib.rs (target/debug/deps/spoken_intent-a16e3c61734de2f2)
test result: ok. 7 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
     Running tests/grammar.rs (target/debug/deps/grammar-4adb1047d5dc1887)
test result: ok. 15 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
     Running tests/vectors.rs (target/debug/deps/vectors-21056aa4746d8cc3)
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.03s
   Doc-tests spoken_intent
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
exit 0
```

```text
$ diff <(jq -S .requests speak-to-sign/spoken-intent/fixtures/spoken_intent_vectors_v1.json) <(jq -S .requests seams-wallet/crates/spoken-intent/fixtures/spoken_intent_vectors_v1.json) && echo 'the 24 request vectors are the same'
the 24 request vectors are the same
exit 0
```

## 2. The verifier

```text
$ (cd speak-to-sign/voice-verifier && cargo test 2>&1 | grep -E 'Running|Doc-tests|test result')
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
exit 0
```

```text
$ (cd speak-to-sign/voice-verifier && cargo test --test ops -- note rating 2>&1 | grep -E '^test')
test note_inputs_that_are_not_speakable_are_unsupported ... ok
test verify_accepts_a_spoken_rating_with_exact_words ... ok
test verify_accepts_a_spoken_note_summary ... ok
test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 10 filtered out; finished in 0.82s
exit 0
```

## 3. The Wallet verdict check

```text
$ (cd seams-wallet && pnpm install --frozen-lockfile)
Scope: all 13 workspace projects
✓ Lockfile passes supply-chain policies (verified 1d ago)
Lockfile is up to date, resolution step is skipped
Packages: +508
++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
Progress: resolved 0, reused 1, downloaded 0, added 0
Progress: resolved 0, reused 496, downloaded 0, added 296
Progress: resolved 0, reused 496, downloaded 0, added 507
Progress: resolved 0, reused 496, downloaded 0, added 508, done
node_modules/sharp install$ node install/check.js || npm run build
node_modules/utf-8-validate install$ node-gyp-build
node_modules/bufferutil install$ node-gyp-build
node_modules/utf-8-validate install: Done
node_modules/bufferutil install: Done
node_modules/sharp install: Done
[WARN] Failed to create bin at <check>/seams-wallet/apps/docs/node_modules/.bin/seams-voiceid-host. ENOENT: no such file or directory, chmod '<check>/seams-wallet/apps/docs/node_modules/@seams/voiceid/dist/compose-host.mjs'
[WARN] Failed to create bin at <check>/seams-wallet/crates/router-ab-cloudflare/node_modules/.bin/seams-wallet-server-local-roles. ENOENT: no such file or directory, chmod '<check>/seams-wallet/crates/router-ab-cloudflare/node_modules/@seams/wallet-server/cloudflare-router-ab/scripts/start-local-role-workers.mjs'
[WARN] Failed to create bin at <check>/seams-wallet/crates/router-ab-cloudflare/node_modules/.bin/seams-wallet-server-local-init. ENOENT: no such file or directory, chmod '<check>/seams-wallet/crates/router-ab-cloudflare/node_modules/@seams/wallet-server/cloudflare-router-ab/scripts/initialize-local-wallet.mjs'
[WARN] Failed to create bin at <check>/seams-wallet/crates/router-ab-cloudflare/node_modules/.bin/seams-wallet-server-local. ENOENT: no such file or directory, chmod '<check>/seams-wallet/crates/router-ab-cloudflare/node_modules/@seams/wallet-server/cloudflare-router-ab/scripts/start-local-wallet-system.mjs'
[WARN] Failed to create bin at <check>/seams-wallet/examples/seams-auth-menu/node_modules/.bin/seams-wallet-server-local-init. ENOENT: no such file or directory, chmod '<check>/seams-wallet/examples/seams-auth-menu/node_modules/@seams/wallet-server/cloudflare-router-ab/scripts/initialize-local-wallet.mjs'
[WARN] Failed to create bin at <check>/seams-wallet/examples/seams-auth-menu/node_modules/.bin/seams-wallet-server-local-roles. ENOENT: no such file or directory, chmod '<check>/seams-wallet/examples/seams-auth-menu/node_modules/@seams/wallet-server/cloudflare-router-ab/scripts/start-local-role-workers.mjs'
[WARN] Failed to create bin at <check>/seams-wallet/examples/seams-auth-menu/node_modules/.bin/seams-wallet-server-local. ENOENT: no such file or directory, chmod '<check>/seams-wallet/examples/seams-auth-menu/node_modules/@seams/wallet-server/cloudflare-router-ab/scripts/start-local-wallet-system.mjs'
[WARN] Failed to create bin at <check>/seams-wallet/packages/speak-to-sign/node_modules/.bin/seams-voiceid-host. ENOENT: no such file or directory, chmod '<check>/seams-wallet/packages/speak-to-sign/node_modules/@seams/voiceid/dist/compose-host.mjs'
[WARN] Failed to create bin at <check>/seams-wallet/tests/node_modules/.bin/seams-speak-to-sign-host. ENOENT: no such file or directory, chmod '<check>/seams-wallet/tests/node_modules/@seams/speak-to-sign/dist/compose-host.mjs'
[WARN] Failed to create bin at <check>/seams-wallet/tests/node_modules/.bin/seams-voiceid-host. ENOENT: no such file or directory, chmod '<check>/seams-wallet/tests/node_modules/@seams/voiceid/dist/compose-host.mjs'
[WARN] Failed to create bin at <check>/seams-wallet/tests/intended-app/node_modules/.bin/seams-speak-to-sign-host. ENOENT: no such file or directory, chmod '<check>/seams-wallet/tests/intended-app/node_modules/@seams/speak-to-sign/dist/compose-host.mjs'
[WARN] Failed to create bin at <check>/seams-wallet/tests/intended-app/node_modules/.bin/seams-voiceid-host. ENOENT: no such file or directory, chmod '<check>/seams-wallet/tests/intended-app/node_modules/@seams/voiceid/dist/compose-host.mjs'

Done in 4s using pnpm v11.11.0
exit 0
```

```text
$ (cd seams-wallet && pnpm -C tests exec playwright test -c playwright.wallet-browser.config.ts unit/speakToSignHost.unit.test.ts --project=chromium --reporter=list)

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
exit 0
```

## 4. The notes contract

```text
$ (cd speak-to-sign/community-notes && cargo test -p community-notes 2>&1 | grep -E 'Running|Doc-tests|test result')
     Running unittests src/lib.rs (target/debug/deps/community_notes-341177214784ea2e)
test result: ok. 24 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.12s
   Doc-tests community_notes
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
exit 0
```

```text
$ (cd speak-to-sign/community-notes && ./build.sh 2>&1 | tail -3)
res/community_notes.wasm
size:    169267 bytes
sha256:  472d1eaa420b22d71439bf2db341a45d59ba9aa63b094e758e9a3af3a561a253
exit 0
```

```text
$ (cd speak-to-sign/community-notes && cargo test -p community-notes-sandbox 2>&1 | grep -E 'Running|Doc-tests|test result|^test')
     Running unittests src/lib.rs (target/debug/deps/community_notes_sandbox-0384b741abce45f1)
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
     Running tests/sandbox.rs (target/debug/deps/sandbox-22e3bc6f6ae3ec0d)
test community_notes_in_the_sandbox ... ok
test get_notes_with_50_of_the_largest_notes ... ok
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 20.74s
   Doc-tests community_notes_sandbox
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
exit 0
```

## 5. Live testnet facts

```text
$ view() { curl -s https://rpc.testnet.near.org -H 'Content-Type: application/json' -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"query\",\"params\":{\"request_type\":\"call_function\",\"finality\":\"final\",\"account_id\":\"$1\",\"method_name\":\"$2\",\"args_base64\":\"$(printf '%s' "$3" | base64 | tr -d '\n')\"}}" | jq -r '.result.result | implode'; }; view outlayer.testnet get_version '{"project_id":"seams-v1.testnet/voice-verifier","version_key":"8a0b7ba0dff61a4b45e5d1d164c011525e11fe9f4fd02a4e22368882447329ef"}' | jq -c '{wasm_hash, is_active, url: .source.WasmUrl.url}'
{"wasm_hash":"8a0b7ba0dff61a4b45e5d1d164c011525e11fe9f4fd02a4e22368882447329ef","is_active":false,"url":"https://test.fastfs.io/seams-v1.testnet/outlayer.testnet/8a0b7ba0dff61a4b45e5d1d164c011525e11fe9f4fd02a4e22368882447329ef.wasm"}
exit 0
```

```text
$ curl -sL https://test.fastfs.io/seams-v1.testnet/outlayer.testnet/8a0b7ba0dff61a4b45e5d1d164c011525e11fe9f4fd02a4e22368882447329ef.wasm | shasum -a 256
8a0b7ba0dff61a4b45e5d1d164c011525e11fe9f4fd02a4e22368882447329ef  -
exit 0
```

```text
$ view() { curl -s https://rpc.testnet.near.org -H 'Content-Type: application/json' -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"query\",\"params\":{\"request_type\":\"call_function\",\"finality\":\"final\",\"account_id\":\"$1\",\"method_name\":\"$2\",\"args_base64\":\"$(printf '%s' "$3" | base64 | tr -d '\n')\"}}" | jq -r '.result.result | implode'; }; view outlayer.testnet get_project '{"project_id":"seams-v1.testnet/voice-verifier"}' | jq -c '{owner, active_version}'
{"owner":"seams-v1.testnet","active_version":"d078eb11eee0f11c5cc72d1284885b13ef5212a0862be123d1d43a3a5e83d54c"}
exit 0
```

```text
$ view() { curl -s https://rpc.testnet.near.org -H 'Content-Type: application/json' -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"query\",\"params\":{\"request_type\":\"call_function\",\"finality\":\"final\",\"account_id\":\"$1\",\"method_name\":\"$2\",\"args_base64\":\"$(printf '%s' "$3" | base64 | tr -d '\n')\"}}" | jq -r '.result.result | implode'; }; view outlayer.testnet get_version '{"project_id":"seams-v1.testnet/voice-verifier","version_key":"d078eb11eee0f11c5cc72d1284885b13ef5212a0862be123d1d43a3a5e83d54c"}' | jq -c '{wasm_hash, is_active, added_at}'
{"wasm_hash":"d078eb11eee0f11c5cc72d1284885b13ef5212a0862be123d1d43a3a5e83d54c","is_active":true,"added_at":1794227029277031521}
exit 0
```

```text
$ view() { curl -s https://rpc.testnet.near.org -H 'Content-Type: application/json' -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"query\",\"params\":{\"request_type\":\"call_function\",\"finality\":\"final\",\"account_id\":\"$1\",\"method_name\":\"$2\",\"args_base64\":\"$(printf '%s' "$3" | base64 | tr -d '\n')\"}}" | jq -r '.result.result | implode'; }; view notes.seams-v1.testnet get_notes '{"post_id":9999}' | jq -c '.[] | {id, author, summary, status}'
{"id":1,"author":"seams-v1.testnet","summary":"Smoke test after deploy","status":"needs_more_ratings"}
exit 0
```

```text
$ view() { curl -s https://rpc.testnet.near.org -H 'Content-Type: application/json' -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"query\",\"params\":{\"request_type\":\"call_function\",\"finality\":\"final\",\"account_id\":\"$1\",\"method_name\":\"$2\",\"args_base64\":\"$(printf '%s' "$3" | base64 | tr -d '\n')\"}}" | jq -r '.result.result | implode'; }; for p in 1 2 3 4 5; do view notes.seams-v1.testnet get_notes "{\"post_id\":$p}"; done
[]
[]
[]
[]
[]
exit 0
```

```text
$ curl -s https://rpc.testnet.near.org -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"query","params":{"request_type":"view_account","finality":"final","account_id":"notes.seams-v1.testnet"}}' | jq -r .result.code_hash
5nqrLnLpoZrtxbMQQKFB9CoowyEXJ9notqsHe51dBjPY
exit 0
```

## Baseline and hackathon work

```text
$ first() { TZ=UTC git -C "$1" log --diff-filter=A --reverse --date=format-local:'%Y-%m-%d %H:%M' --format='%ad UTC %h %s' -- "$2" | head -1 | cut -c1-100; }
first seams-wallet crates/ed25519-yao
first seams-wallet packages/wallet/src/react/components/VoiceAssistantCard.tsx
TZ=UTC git -C seams-wallet log -1 --before=2026-10-19T00:00:00Z --date=format-local:'%Y-%m-%d %H:%M' --format='%cd UTC %h %s'
TZ=UTC git -C seams-wallet log -i --grep=voiceid --reverse --date=format-local:'%Y-%m-%d %H:%M' --format='%ad UTC %h %s' | sed -n 2p
first speak-to-sign spoken-intent
first speak-to-sign voice-verifier
first seams-wallet packages/speak-to-sign
TZ=UTC git -C speak-to-sign log -S community_note --reverse --date=format-local:'%Y-%m-%d %H:%M' --format='%ad UTC %h %s' -- voice-verifier/src | head -1
first speak-to-sign community-notes
TZ=UTC git -C seams-wallet log -S add_note --reverse --date=format-local:'%Y-%m-%d %H:%M' --format='%ad UTC %h %s' -- packages/wallet/src | head -1
TZ=UTC git -C speak-to-sign log -1 --date=format-local:'%Y-%m-%d %H:%M' --format='%ad UTC %h %s' e25f1ec
first speak-to-sign examples
2026-09-11 17:10 UTC cdb1c4a1 Initial Seams Wallet repository
2026-10-13 03:28 UTC 21503882 Add reusable voice assistant UI for future VoiceID
2026-10-18 23:54 UTC 620794d9 perf(registration): reuse the committed admission for combined execution
2026-10-22 16:36 UTC 9ace901f feat(voiceid): gate reviewed testnet transfers through native approval
2026-11-07 06:50 UTC 923e576 Add the spoken-intent crate for Refactor 210 voice intents: one no_std 
2026-11-07 12:21 UTC 6e5abf1 Refactor 210 Speak-to-Sign: Gate 0 probes (tract inference, wasmtime fu
2026-11-07 12:20 UTC 4b0d7981 Add the optional @seams/speak-to-sign module skeleton: a type-only des
2026-11-09 10:14 UTC ff1409b Verifier 0.4.0: spoken community notes and note ratings
2026-11-09 10:21 UTC 7f0e014 Community notes contract for the Speak-to-Sign demo
2026-11-09 10:25 UTC bec40080 Speak-to-Sign: spoken community notes and note ratings
2026-11-09 10:33 UTC e25f1ec Spoken Notes demo: X-style Community Notes page, posted and rated by voice
2026-11-09 11:05 UTC 2999fd6 Speak to pay example: pay a NEAR testnet account by voice
exit 0
```

```text
$ TZ=UTC git -C speak-to-sign log --date=format-local:'%Y-%m-%d %H:%M' --format='%ad UTC %h %s' | sort | head -1 | cut -c1-100
2026-11-07 06:50 UTC 923e576 Add the spoken-intent crate for Refactor 210 voice intents: one no_std 
exit 0
```

```text
$ git -C seams-wallet diff --shortstat 620794d91 b12cf643c -- packages/voiceid packages/speak-to-sign packages/wallet/src/core/transactionFeatures crates/spoken-intent
 91 files changed, 17110 insertions(+)
exit 0
```

## Appendix: every test name

```text
$ (cd speak-to-sign/spoken-intent && cargo test 2>&1 | grep -E '^test ' | sort)
test accepted_parses_render_back_to_the_same_tokens ... ok
test account_separators_can_be_said_differently_or_left_out ... ok
test amounts_are_exact_and_bounded ... ok
test an_implicit_owner_is_valid_and_not_said ... ok
test committed_spoken_intent_vectors_match_generator ... ok
test dot_before_testnet_keeps_the_contact_match ... ok
test joined_words_match_by_the_sound_of_the_sentence_end ... ok
test negations_and_added_clauses_are_refused ... ok
test note_summaries_keep_separator_words_and_oh ... ok
test plan_examples_render_exactly ... ok
test punctuated::tests::aliases_are_not_grammar_words ... ok
test punctuated::tests::text_step_matches_rule_w2 ... ok
test punctuated_transcripts_read_like_the_rendered_text ... ok
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.02s
test result: ok. 15 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
test result: ok. 7 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
test send_slots_forgive_words_that_hold_no_value ... ok
test sound_alike_accounts_are_confusable ... ok
test speech_to_text_forms_normalize_to_the_rendered_tokens ... ok
test summary::tests::borsh_refuses_unspeakable_text ... ok
test summary::tests::plain_sentences_are_summaries ... ok
test summary::tests::transcripts_of_a_summary_match ... ok
test summary::tests::twelve_words_is_the_limit ... ok
test summary::tests::unstable_text_is_refused ... ok
test two_heard_as_to_fills_only_a_one_word_amount_slot ... ok
test unspeakable_accounts_are_refused ... ok
exit 0
```

```text
$ (cd speak-to-sign/voice-verifier && cargo test 2>&1 | grep -E '^test ' | sort)
test a_long_transcript_still_fits_and_is_signed ... ok
test a_step_up_with_the_longest_heard_text_still_fits ... ok
test audio::tests::energy_gate_rules ... ok
test audio::tests::wav_refusals ... ok
test audio::tests::wav_round_trip_and_extra_chunks ... ok
test authorization_vector_passes_the_enroll_check ... ok
test config::tests::manifest_matches_the_constants ... ok
test config::tests::nep413_tag_is_two_to_the_31_plus_413 ... ok
test config::tests::storage_keys_name_the_owner ... ok
test digest::tests::base58_known_values ... ok
test digest::tests::base58_round_trip ... ok
test digest::tests::base64_forms ... ok
test digest::tests::hex_round_trip ... ok
test digest_vector_is_what_enroll_computes ... ok
test enroll_needs_a_full_access_key_of_the_owner ... ok
test enroll_refusals ... ok
test enroll_stores_the_template_and_returns_the_key ... ok
test enrollment::tests::digest_preimage ... ok
test enrollment::tests::nep413_payload_bytes ... ok
test enrollment::tests::only_the_signature_of_this_digest_passes ... ok
test enrollment::tests::view_replies ... ok
test enrollment::tests::view_request ... ok
test input::tests::the_request_is_tagged_by_kind ... ok
test input::tests::unknown_fields_are_refused ... ok
test input::tests::yocto_text ... ok
test note_inputs_that_are_not_speakable_are_unsupported ... ok
test output::tests::message_is_the_domain_then_the_bytes ... ok
test output::tests::reasons_serialize_in_snake_case ... ok
test output::tests::verdict_has_thirteen_fields_in_order ... ok
test policy::tests::above_ten_near_steps_up ... ok
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
test result: ok. 13 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.87s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
test result: ok. 36 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s
test speaker::tests::enrollment_agrees_and_makes_a_unit_mean ... ok
test speaker::tests::enrollment_refuses_a_different_sample ... ok
test speaker::tests::model_digest_parses_the_pin ... ok
test speaker::tests::normalization_and_refusals ... ok
test speaker::tests::similarity_rounds_down_and_cutoff_is_inclusive ... ok
test speaker::tests::template_record_round_trip_and_refusals ... ok
test transcriber::tests::replies ... ok
test transcriber::tests::request_has_only_the_three_fields_and_the_key ... ok
test transfer_request_accepts_an_implicit_owner ... ok
test unknown_op ... ok
test vector_is_what_this_verifier_signs ... ok
test verify_accepts_a_spoken_note_summary ... ok
test verify_accepts_a_spoken_rating_with_exact_words ... ok
test verify_accepts_and_signs_the_verdict ... ok
test verify_refusals ... ok
test verify_steps_up_above_ten_near ... ok
test words::tests::exact_text_matches ... ok
test words::tests::heard_is_cut_at_a_word_end ... ok
test words::tests::near_misses_are_refused ... ok
test words::tests::text_that_does_not_normalize_is_refused_and_cleaned ... ok
test words::tests::whisper_style_transcripts_match ... ok
test words::tests::word_edit_distance ... ok
exit 0
```

```text
$ (cd speak-to-sign/community-notes && cargo test -p community-notes 2>&1 | grep -E '^test ' | sort)
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
test result: ok. 24 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.12s
test tests::a_later_rating_replaces_the_earlier_rating ... ok
test tests::a_rating_is_per_note ... ok
test tests::add_note_logs_note_added ... ok
test tests::add_note_stores_the_note_and_counts_ids_from_1 ... ok
test tests::author_cannot_rate_their_own_note - should panic ... ok
test tests::empty_summary_fails - should panic ... ok
test tests::empty_text_fails - should panic ... ok
test tests::get_notes_returns_the_newest_50_of_the_post ... ok
test tests::get_notes_shows_current_counts ... ok
test tests::note_view_json_uses_numbers_and_snake_case ... ok
test tests::rate_note_counts_the_rating_and_logs_note_rated ... ok
test tests::rating_an_unknown_note_fails - should panic ... ok
test tests::rating_and_status_json_strings ... ok
test tests::rating_note_0_fails - should panic ... ok
test tests::somewhat_helpful_does_not_change_the_status ... ok
test tests::status_follows_the_ratings_on_the_contract ... ok
test tests::status_thresholds ... ok
test tests::summary_longer_than_120_characters_fails - should panic ... ok
test tests::summary_of_only_white_space_fails - should panic ... ok
test tests::text_and_summary_accept_the_maximum_length_in_characters_not_bytes ... ok
test tests::text_longer_than_280_characters_fails - should panic ... ok
test tests::text_of_only_white_space_fails - should panic ... ok
test tests::the_same_rating_twice_counts_once ... ok
test tests::unknown_ids_in_views_give_empty_results ... ok
exit 0
```
