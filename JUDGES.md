# Speak-to-Sign: a guide for judges

The shortest path to see that Speak-to-Sign works, and to check each claim.
[`README.md`](README.md) is the full reference.

## What it is

The owner of a NEAR account approves one exact call: they say one sentence.
An attested verifier (an OutLayer TEE worker) checks the voice and the heard
words, and signs a verdict that binds both to the digest of the request.
Seams Wallet core signs the call only with a verdict for that request.
Testnet only.

Wallet core is the npm dependency `@seams/wallet` 0.63.0, which the demo pins
in `demo/frontend/package.json`. It checks the verdict against a pinned key
and signs only a matching request. Its source is
[`seams-wallet` at 0.63.0](https://github.com/seams-tech/seams-wallet/tree/6373a68a726c28c8d835a9e91359955353dc811b).
Every command below needs only this repo.

## See it in 2 minutes

You need a browser with passkeys and a microphone.

1. Open <https://seams-voice-intents.pages.dev/>.
2. Do the three setup steps: **Create a wallet** (a passkey), **Set up your
   voice** (three short clips) and **Testnet NEAR and USDC** (the faucet).
3. On a post, press **Write a note**, type a note and read its summary aloud.
   The Wallet signs `add_note` on `notes.seams-v1.testnet` from your account.
4. To see a refusal, read a different summary, or add or drop a "not". The
   card shows the reason and the words that the verifier heard. Nothing is
   signed.

| Item       | Link                                             |
| ---------- | ------------------------------------------------ |
| Demo video | TODO: the owner adds the link to the demo video. |
| X post     | TODO: the owner adds the link to the X post.     |

## Check it without a microphone

You need `git`, `curl`, `jq`, Rust from rustup (it installs the pinned
toolchains), Node 24 with pnpm (`corepack enable`) for check 2, and Docker for
check 3. Run each command from
the folder that holds the clone. The `# See:` line above each command is the
result of a run on 2026-11-11 (macOS, arm64).

```bash
git clone https://github.com/seams-tech/speak-to-sign
```

1. The tests. The sandbox test downloads a nearcore sandbox on its first run.

   ```bash
   # See: 9 "ok" lines, 39 passed. The golden vectors match the code.
   (cd speak-to-sign/crates/spoken-intent && cargo test 2>&1 | grep 'test result')
   # See: 9 "ok" lines, 133 passed.
   (cd speak-to-sign/crates/voice-verifier && cargo test 2>&1 | grep 'test result')
   # See: 3 notes:: tests ok, the summary rules of README step 2.
   (cd speak-to-sign/crates/voice-verifier && cargo test --test ops notes:: 2>&1 | grep '^test')
   # See: 32 passed.
   (cd speak-to-sign/demo/contracts/community-notes && cargo test -p community-notes 2>&1 | grep 'test result')
   # See: 3 tests ok in a local nearcore sandbox, after build.sh makes the WASM.
   (cd speak-to-sign/demo/contracts/community-notes && ./build.sh > /dev/null 2>&1 && cargo test -p community-notes-sandbox 2>&1 | grep '^test ')
   # See: 15 passed. The multisig contract refuses each bad verdict on chain.
   (cd speak-to-sign/demo/contracts/voice-multisig && cargo test verdict 2>&1 | grep 'test result')
   ```

2. The verdict check. `@seams/voice-verdict` (`packages/voice-verdict/`)
   checks a signed verdict before anything is signed: the pinned key, the
   signature, the fields, the expiry, and the request and sentence digests.

   ```bash
   # See: 6 lines that start with "✔ a", then "ℹ pass 51" and "ℹ fail 0".
   # One line: "a verdict for one community note does not pass for another note".
   (cd speak-to-sign/packages/voice-verdict && pnpm install --frozen-lockfile >/dev/null && pnpm test 2>&1 | grep -E '^✔ a (step-up |verdict)|^ℹ (pass|fail)' | sed 's/ ([0-9.]*ms)//')
   ```

3. The active verifier comes from this source. Build commit `a816798` in
   Docker, then read the active version on OutLayer.

   ```bash
   # See: sha256 bfe81633b9ed596df239201f153a84c860d71ddd8edf713c1c785ef2b7c1c946
   (cd speak-to-sign && git checkout --quiet a816798 && crates/voice-verifier/build.sh --docker 2>&1 | tail -1; git checkout --quiet dev)
   # See: the same hash (verifier 0.12.0).
   curl -s https://rpc.testnet.near.org -H 'Content-Type: application/json' -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"query\",\"params\":{\"request_type\":\"call_function\",\"finality\":\"final\",\"account_id\":\"outlayer.testnet\",\"method_name\":\"get_project\",\"args_base64\":\"$(printf '%s' '{"project_id":"seams-v1.testnet/voice-verifier"}' | base64 | tr -d '\n')\"}}" | jq -r '.result.result | implode | fromjson | .active_version'
   ```

4. The deployed notes contract.

   ```bash
   # See: GUxwJuESkn4FAZcW5oacs15zPzBfh1qSPHpVauyqkewP
   curl -s https://rpc.testnet.near.org -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"query","params":{"request_type":"view_account","finality":"final","account_id":"notes.seams-v1.testnet"}}' | jq -r .result.code_hash
   ```

   It is the base58 form of `e6093bb1…26be`, the `build.sh` WASM of `dev`
   01dde86 on the computer that deployed it, from the upgrade of 2026-11-11
   (see "Not covered").

## Claim -> where to check it

"Spec" is [`docs/voice-intents-spec.md`](docs/voice-intents-spec.md).

| Claim | Where |
| ----- | ----- |
| One crate makes the sentence and the request digest; the golden file matches the code. | `committed_spoken_intent_vectors_match_generator` in `crates/spoken-intent/tests/vectors.rs`; spec section 4 |
| An added or dropped "not" is refused. One changed or dropped word in a summary of 4 words or more passes. | `verify_accepts_a_spoken_note_summary` in `crates/voice-verifier/tests/ops/notes.rs`; rule `words_pass` in `crates/voice-verifier/src/words.rs`; spec 7.2 |
| Another voice is refused (cosine below 0.45). | `verify_refuses_another_speaker` in `crates/voice-verifier/tests/ops/verify.rs` |
| The speaker key comes from a TDX attestation, and a reply that fails its signature is refused. | `SPEAKER_PINNED_KEY_HEX` in `crates/voice-verifier/src/config.rs`; `verify_refuses_a_speaker_reply_that_fails_its_signature`; spec 7.1 |
| Each recording passes one time, also after a refusal. | `verify_refuses_other_words_and_uses_the_audio`; spec section 5 |
| A voice payment above 10 NEAR needs a passkey too (`step_up`). | `verify_steps_up_above_ten_near`; spec 7.3 |
| The verifier signs fixed verdict vectors that the Wallet tests also read. A verdict expires after 120 s. | `tests/signed_vector.rs` of the verifier (`testdata/signed_verdict_v2.json`); `VERDICT_TTL_MS` in `src/config.rs`; spec section 8 |
| A verdict for another note is refused (`request_mismatch`). | "a verdict for one community note does not pass for another note" in `packages/voice-verdict/tests/verdict.test.ts`; check 2 above; spec section 9 |
| With the verdict of this note, Wallet core signs one `add_note` and nothing more. | In the dependency: [`signNoteWithVerdict`](https://github.com/seams-tech/seams-wallet/blob/6373a68a726c28c8d835a9e91359955353dc811b/packages/wallet/src/core/transactionFeatures/hostOperations.ts#L273) and its [test](https://github.com/seams-tech/seams-wallet/blob/6373a68a726c28c8d835a9e91359955353dc811b/tests/unit/speakToSignHost.unit.test.ts#L978) |
| The voice multisig contract checks the verdict on chain: key, expiry, owner, commitment. | `a_verdict_of_another_key_fails`, `an_expired_verdict_fails`, `a_verdict_for_another_commitment_fails` in `demo/contracts/voice-multisig/src/tests.rs` |
| A sealed recording opens only for its owner and operation. | `sealed_audio_opens_only_for_its_owner_and_operation` in `crates/voice-verifier/tests/ops/sealed.rs`; spec 5.1 |
| The active verifier comes from this source. | Check 3 above; `crates/voice-verifier/README.md`, "Reproducible build" |

## Not covered

From [`docs/architecture.md`](docs/architecture.md) section 8, "Trust
boundaries", and spec section 11:

- A good voice clone that a compromised device plays can pass. This build has
  no liveness check and no fresh words.
- The NEAR AI transcript has no signature. A false transcript can pass the
  word check.
- The owner of the OutLayer project can deploy new code that signs with the
  same key. The Wallet pins the key, not the code.
- The Phala app owner can change the speaker service and keep its key.
- The verifier does not check a proof of the NEAR RPC access-key view at
  enrollment.
- The deployed contracts came from local `build.sh` builds, so their code is
  not the reproducible build of `demo/contracts/reproducible.sh`. A redeploy
  of the reproducible WASM would make it checkable. The verifier build is
  reproducible.
- Testnet only.

## Baseline and hackathon work

Seams Wallet is the baseline; all of this repository was made in the window.
See README [Baseline and hackathon work](README.md#baseline-and-hackathon-work).
