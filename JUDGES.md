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
toolchains) and Docker (for the verifier build only). Run each command from
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

2. The active verifier comes from this source. Build commit `be35842` in
   Docker, then read the active version on OutLayer.

   ```bash
   # See: sha256 d2f8b63016e6465d614240989f60ff60ad1d0d8dcff7c247e2d4306fc197d9f8
   (cd speak-to-sign && git checkout --quiet be35842 && crates/voice-verifier/build.sh --docker 2>&1 | tail -1; git checkout --quiet dev)
   # See: the same hash (verifier 0.11.0).
   curl -s https://rpc.testnet.near.org -H 'Content-Type: application/json' -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"query\",\"params\":{\"request_type\":\"call_function\",\"finality\":\"final\",\"account_id\":\"outlayer.testnet\",\"method_name\":\"get_project\",\"args_base64\":\"$(printf '%s' '{"project_id":"seams-v1.testnet/voice-verifier"}' | base64 | tr -d '\n')\"}}" | jq -r '.result.result | implode | fromjson | .active_version'
   ```

3. The deployed notes contract.

   ```bash
   # See: 5nqrLnLpoZrtxbMQQKFB9CoowyEXJ9notqsHe51dBjPY
   curl -s https://rpc.testnet.near.org -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"query","params":{"request_type":"view_account","finality":"final","account_id":"notes.seams-v1.testnet"}}' | jq -r .result.code_hash
   ```

   It is the base58 form of `472d1eaa…a253`, the `build.sh` WASM of commit
   `a3c3660` on the computer that deployed it (see "Not covered").

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
| Wallet core refuses a verdict for another note and signs nothing. | In the dependency: [`signNoteWithVerdict`](https://github.com/seams-tech/seams-wallet/blob/6373a68a726c28c8d835a9e91359955353dc811b/packages/wallet/src/core/transactionFeatures/hostOperations.ts#L273) and its [test](https://github.com/seams-tech/seams-wallet/blob/6373a68a726c28c8d835a9e91359955353dc811b/tests/unit/speakToSignHost.unit.test.ts#L978) (`request_digest differs`); spec section 9 |
| The voice multisig contract checks the verdict on chain: key, expiry, owner, commitment. | `a_verdict_of_another_key_fails`, `an_expired_verdict_fails`, `a_verdict_for_another_commitment_fails` in `demo/contracts/voice-multisig/src/tests.rs` |
| A sealed recording opens only for its owner and operation. | `sealed_audio_opens_only_for_its_owner_and_operation` in `crates/voice-verifier/tests/ops/sealed.rs`; spec 5.1 |
| The active verifier comes from this source. | Check 2 above; `crates/voice-verifier/README.md`, "Reproducible build" |

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
- The contract WASM build is not reproducible on another computer: the WASM
  holds local source paths. The verifier build is reproducible.
- Testnet only.

## Baseline and hackathon work

Seams Wallet is the baseline; all of this repository was made in the window.
See README [Baseline and hackathon work](README.md#baseline-and-hackathon-work).
