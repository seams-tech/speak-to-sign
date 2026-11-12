# Speak-to-Sign: a guide for judges

The shortest path to see that Speak-to-Sign works, and to check each claim.
[`README.md`](README.md) is the full reference.

## What it is

The owner of a NEAR account approves one exact call: they say one sentence.
An attested verifier (an OutLayer TEE worker) checks the voice and the heard
words, and signs a verdict that binds both to the digest of the request.
Seams Wallet core signs the call only with a verdict for that request.
Testnet only.

Wallet core is the npm dependency `@seams/wallet` 0.67.0, which the demo pins
in `demo/frontend/package.json`. It checks the verdict against a pinned key
and signs only a matching request. Its source is
[`seams-wallet` at 0.67.0](https://github.com/seams-tech/seams-wallet/tree/6ae9e42a93ec1df5f958256b0427bb8e403137ed).
Every command below needs only this repo.

## Why it is useful

Each use case below says what works today and what is not done yet.

### 1. Hands-free finance: one sentence instead of approval prompts

People now give AI agents spoken commands. When an agent must spend money,
it stops, and the user reads a prompt and clicks through it. Many prompts in
a row cause approval fatigue: people click "approve" and do not read. With
Speak-to-Sign, the spoken sentence is the approval. The sentence states the
intent ("send 2 NEAR to alice.testnet"), and the voice shows who said it. The
user does not type, and does not click through a prompt.

- **Today:** speak to pay (`examples/speak-to-pay/`, at `/pay/` of the demo
  site) pays one exact amount to one exact account. Above 10 NEAR, the
  verifier asks for a passkey too (`step_up`).
- **Not done:** no agent proposes the call yet, and the user reads the
  sentence from the screen. A verdict usually takes about 2 s, but the
  OutLayer delay has gone above 90 s.

### 2. Spoken multisig: signers know what they sign

Multisig transactions are hard to read, and signing them is tedious, so
signers often sign blind. On 21 February 2025, attackers took about
US$1.5 billion from Bybit. They changed the Safe{Wallet} page, and the
signers approved a transaction that they did not see. When each signer reads
the request aloud, the signer hears what they approve. The verifier checks
the heard words against the request that is signed, so the words on a
changed page do not match.

- **Today:** `demo/contracts/voice-multisig/` (version 3.0.0) is voice only:
  M of N signers and no admin. A signer proposes a transfer, or the hide of a
  note, by voice. Each other signer says the same proposal from memory, and
  approves with a verdict of its own (the verifier's `multisig_confirm`). The
  contract checks each verdict on chain: key, expiry, owner, commitment. One
  recording counts once, and no call without a verdict can approve. The unit
  tests and a local nearcore sandbox test show this.
- **Not done:** version 3.0.0 is not deployed, and the demo site has no page
  for the multisig. `multisig.seams-v1.testnet` still runs version 2.x, where
  two admins approve with a plain signed call. The signers are fixed at
  `new`: a voice-approved change of the signers does not exist yet.

### 3. Social sites and marketplaces: actions that are easy for people and costly for bots

Bots and AI agents now write a large part of the reviews, replies and
comments on the web. Speak-to-Sign puts a voice step into the actions that
matter: a community note, a rating, a review or a bet. For a person, one
sentence read aloud is natural and fast. For a bot farm, it adds a cost to
each action: each account needs a voice, and each action needs new audio of
the exact text.

- **Today:** the community notes demo. Each note, rating and bet needs the
  enrolled voice of the account, and each recording passes one time only. A
  bot that takes over an account cannot post as that account without the
  owner's voice or a good clone of it.
- **Not done:** this build cannot prove that a live person speaks. A
  text-to-speech voice can enroll and pass, and one voice can enroll on many
  accounts. To make bot farms costly, the verifier needs a liveness check
  (fresh words), synthetic-speech detection and one voice per account.

## See it in 2 minutes

You need a browser with passkeys and a microphone.

1. Open <https://speak-to-sign.pages.dev/>.
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
   # See: 19 passed. The multisig contract refuses each bad verdict on chain.
   (cd speak-to-sign/demo/contracts/voice-multisig && cargo test verdict 2>&1 | grep 'test result')
   # See: 14 passed. Each approval is a verdict of its own signer, from a new recording.
   (cd speak-to-sign/demo/contracts/voice-multisig && cargo test approv 2>&1 | grep 'test result')
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

4. The deployed notes contract is the reproducible build of commit `777b844`.

   ```bash
   # See: mvYopouU7PP9ZVbwzTJ6qUH8kDjEiMeP7TDENF9eUko
   curl -s https://rpc.testnet.near.org -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"query","params":{"request_type":"view_account","finality":"final","account_id":"notes.seams-v1.testnet"}}' | jq -r .result.code_hash
   # See: git+https://github.com/seams-tech/speak-to-sign?rev=777b84429096604e77e217480e9f89a398f5da13
   curl -s https://rpc.testnet.near.org -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"query","params":{"request_type":"call_function","finality":"final","account_id":"notes.seams-v1.testnet","method_name":"contract_source_metadata","args_base64":"e30="}}' | jq -r '.result.result | implode | fromjson | .build_info.source_code_snapshot'
   ```

   The code hash is the base58 form of `0b821a5c…7f80`, the SHA-256 in
   `demo/contracts/community-notes/reproducible.sha256`. SourceScan built
   that commit again and got the same code hash, so NearBlocks shows the code
   as verified
   (<https://testnet.nearblocks.io/address/notes.seams-v1.testnet/contract>). To build
   it yourself, see README step 4 (Docker and cargo-near 0.22.0). The other
   three demo contracts are reproducible builds of the same commit, and
   SourceScan verified them too (`demo/contracts/README.md`).

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
| The voice multisig contract checks the verdict on chain: key, expiry, owner, commitment. Each approval is a verdict too: no admin, no plain approve, one recording counts once, M of N to execute. Version 3.0.0 is not deployed yet. | `a_verdict_of_another_key_fails`, `an_expired_verdict_fails`, `a_verdict_for_another_commitment_fails`, `a_plain_approve_without_a_verdict_fails`, `a_verdict_of_a_non_signer_fails`, `the_same_verdict_twice_fails`, `one_recording_for_two_signers_fails`, `an_approval_for_another_commitment_fails`, `execute_below_the_threshold_fails` in `demo/contracts/voice-multisig/src/tests.rs` |
| A sealed recording opens only for its owner and operation. | `sealed_audio_opens_only_for_its_owner_and_operation` in `crates/voice-verifier/tests/ops/sealed.rs`; spec 5.1 |
| The active verifier comes from this source. | Check 3 above; `crates/voice-verifier/README.md`, "Reproducible build" |

## Not covered

From [`docs/architecture.md`](docs/architecture.md) section 8, "Trust
boundaries", and spec section 11:

- A good voice clone that a compromised device plays can pass. This build has
  no liveness check and no fresh words.
- A text-to-speech voice can enroll and pass. The verifier does not detect
  synthetic speech, and it does not refuse one voice on many accounts.
- The NEAR AI transcript has no signature. A false transcript can pass the
  word check.
- The owner of the OutLayer project can deploy new code that signs with the
  same key. The Wallet pins the key, not the code.
- The Phala app owner can change the speaker service and keep its key.
- The verifier does not check a proof of the NEAR RPC access-key view at
  enrollment.
- The OutLayer worker of the note market (`demo/contracts/jev-prediction-market/resolver`)
  has no reproducible build. The four demo contracts and the verifier have
  one.
- Testnet only.

## Baseline and hackathon work

Seams Wallet is the baseline; all of this repository was made in the window.
See README [Baseline and hackathon work](README.md#baseline-and-hackathon-work).
