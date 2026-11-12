# Speak-to-Sign: a guide for judges

The shortest path to see that Speak-to-Sign works, and to check each claim.
[`README.md`](README.md) is the full reference.

## What it is

The owner of a NEAR account approves one exact call: they say one sentence,
for example "Send 2 NEAR to alice.testnet". Then:

1. A verifier checks two things: that the voice is the owner's voice, and
   that the heard words are the words of that call. The verifier runs in a
   TEE on OutLayer, a NEAR service that runs code off chain. A TEE (trusted
   execution environment) is a sealed part of a processor that the host
   cannot read or change. "Attested" means that the TEE hardware can prove
   which code runs in it.
2. If both checks pass, the verifier signs a verdict: a short record that
   says "this voice said these words for this call". The verdict holds the
   request digest (the SHA-256 hash of the exact call), so it is valid for
   that one call only, and for 120 s only.
3. Seams Wallet core, the part of the Wallet that signs, checks the verdict.
   It signs the call only with a verdict for that request.

Testnet only.

Wallet core is the npm dependency `@seams/wallet` 0.69.2, which the demo pins
in `demo/frontend/package.json`. It checks the verdict against a pinned key
and signs only a matching request. Its source is
[`seams-wallet` at 0.69.2](https://github.com/seams-tech/seams-wallet/tree/e9fdc65ae8ae269499dfce423412e446a87d3f0d).
Every command below needs only this repo.

## How it differs

Many entries guard agent spending with caps, allowlists, policy contracts or
an AI judge. A large payment then waits for a person's tap, and a tap shows
only that a device approved something, not what the person read. In
Speak-to-Sign, the approval itself is the spoken exact call (a voice clone
alone cannot sign: see [Questions a judge asks](#questions-a-judge-asks)). An
attested verifier checks the voice and the heard words and binds both to
the digest of the request, and the contracts `pm-notes.seams-v1.testnet` and
`voice-multisig.seams-v1.testnet` check that verdict on chain. Where other
entries confirm by voice, the confirmation is a spoken "yes": nothing checks
who spoke, or binds the words to the call.

## Questions a judge asks

[`docs/judge-questions.md`](docs/judge-questions.md) answers each question
with the evidence. In short:

- **Voice can be cloned.** A clone alone gets nothing. The keys stay on the
  person's device, and voice unlock is bound to that device. A NEAR transfer
  above 10 NEAR also needs a passkey.
- **A changed page or an injected agent** needs no clone, and it fails. The
  person must say the exact call aloud, and the verifier refuses other words.
- **JEV approves nothing.** It classifies the spoken command and opens the
  sheet. The person approves the exact call by voice.
- **Spend guards** decide when a person must approve. Speak-to-Sign makes
  that approval show what the person meant.
- **Who controls the verifier.** Today the Wallet pins the verdict key. The
  next step, which is not built, checks the TDX quote of each call against
  pinned WASM hashes.

## Scope of the hackathon work

The hackathon project is Speak-to-Sign. Seams Wallet is not a part of it.

- **Seams Wallet is the baseline, not hackathon work.** Seams Wallet is a
  programmable embedded wallet that existed before the hackathon. It holds
  the keys and signs with threshold signing. Speak-to-Sign uses it as a
  dependency.
- **Speak-to-Sign is the hackathon work.** All of this repository was made
  in the hackathon window (2026-10-19 to 2026-11-14, UTC):
  - The voice verifier, an OutLayer TEE worker (`crates/voice-verifier/`).
    It gets the heard words from Whisper (a speech-to-text model) on NEAR AI
    Cloud.
  - The speaker service (`crates/speaker-service/`): ReDimNet, a model that
    compares voices, in a Phala confidential VM (a virtual machine in a
    TEE).
  - The `spoken-intent` crate, which makes the sentence and the request
    digest.
  - The voice libraries for an application: `@seams/voice-capture`,
    `@seams/voice-verdict` and `@seams/voice-sign` (`packages/`).
  - The demo: four NEAR contracts and the page (`demo/`), and two examples
    (`examples/`).
- **The integration into the Wallet is hackathon work too.** In the window,
  we added the Speak-to-Sign paths to `seams-wallet`: Wallet core checks the
  verdict and signs only the matching call. These paths are new files only.

README [Baseline and hackathon work](README.md#baseline-and-hackathon-work)
gives the first commit of each part, and the diff of the Wallet in the
window.

## Why it is useful

Each use case below says what works today and what is not done yet.

### 1. Voice-agent payments and hands-free finance: the spoken sentence is the approval

People now give spoken commands to AI assistants, and these assistants
start to handle money. Before money moves, a person must approve the exact
call. Today this approval is a prompt. Many prompts in a row cause approval
fatigue: people click "approve" and do not read. With Speak-to-Sign, the AI
does the routine work: it drafts the note and routes the spoken command to
the right sheet. The AI never proposes or signs a payment. The person
decides when they say the exact call, and the spoken sentence is the
approval. The sentence states the intent ("send 2 NEAR to
alice.testnet"), and the voice shows who said it. Nothing signs the call
without a verdict for that exact call. The person does not type, and does
not click through a prompt.

- **Today, in the community notes app** (the main page of the demo site):
  - **AI routes the command, and signs nothing.** In the voice bar, the
    person says what to do, for example "bet one dollar on no on the second
    note". JEV, an AI classifier, turns the words into a command: the post,
    the side and the amount. The command opens the bet sheet, a note or a
    rating. JEV does not propose a payment, and it signs nothing.
  - **The person approves the exact bet by voice.** The person says the
    sentence that the bet sheet shows, for example "Bet 1 USDC no on
    market 12" (the sheet gives the number of the market). The
    verifier checks the voice and the words. The market contract
    (`pm-notes.seams-v1.testnet`) checks the verdict on chain before it
    takes the USDC: the key, the expiry, and the digest of the bettor,
    market, side and amount. A refused bet fails, and the USDC goes back.
    Each verdict counts once.
  - **AI drafts the note, and the person approves it.** NEAR AI drafts a
    note for each post, and the Seams server writes a short summary of it.
    The person approves the note when they read the summary aloud. The
    write dialog says "Drafted by NEAR AI" under a note that the model
    wrote.
- **Today, speak to pay** (`examples/speak-to-pay/`, at `/pay/` of the demo
  site): the person says the payment, and the Wallet pays one exact amount
  to one exact account. Above 10 NEAR, the verifier asks for a passkey too
  (`step_up`).
- **Not done:** no policy lets software spend a small amount without a
  spoken approval. Speak to pay has no AI step: the person says the payment
  directly. If NEAR AI gives no valid note for a post, the post gets a
  template of its subject, with no "Drafted by NEAR AI" line. The site then
  asks NEAR AI again at a later refresh, 3 times at most. The voice bar uses
  the speech recognition of the browser (Chrome and Safari, not Firefox). A
  verdict usually takes about 2 s, but the OutLayer delay has gone above
  90 s.

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
  It is on `voice-multisig.seams-v1.testnet` since 2026-11-12, with 2 of 2
  signers, and SourceScan verified its code.
- **Not done:** no proposal ran on testnet yet, and the demo site has no
  page or route for the multisig. The older account
  `multisig.seams-v1.testnet` (version 2.x, where two admins approved with a
  plain signed call) was deleted on 2026-11-12. The notes contract now
  names the voice-only multisig as its moderator, so the hide of a note
  needs a proposal that 2 of 2 signers approve by voice. The notes account
  still has a full-access key (see [Not covered](#not-covered)).
  The signers are fixed at `new`: a voice-approved change of the signers
  does not exist yet.

## See it in 2 minutes

You need a browser with passkeys and a microphone.

1. Open <https://speak-to-sign.pages.dev/>.
2. Do the three setup steps: **Create a wallet** (a passkey), **Set up your
   voice** (three short clips) and **Testnet NEAR and USDC** (the faucet).
3. Turn on the voice bar at the foot of the timeline (**Turn voice commands
   on**). Say "show me the open markets", then "bet one dollar on no on the
   second note". JEV opens the bet sheet. Read the bet aloud. The
   market contract `pm-notes.seams-v1.testnet` checks the verdict on chain
   and takes the USDC. If no market is open, say "open a market on the first
   note" first. Without the voice bar, press **Bet** on a post.
4. On a post, press **Write a note**. NEAR AI has drafted the note: the
   dialog says "Drafted by NEAR AI" under it. Read its summary aloud. The Wallet signs `add_note` on `notes.seams-v1.testnet`
   from your account.
5. To see a refusal, read a different summary, or add or drop a "not". The
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
result of a run on 2026-11-12 (macOS, arm64).

```bash
git clone https://github.com/seams-tech/speak-to-sign
```

1. The tests. The sandbox test downloads a nearcore sandbox on its first run.

   ```bash
   # See: 9 "ok" lines, 39 passed. The golden vectors match the code.
   (cd speak-to-sign/crates/spoken-intent && cargo test 2>&1 | grep 'test result')
   # See: 9 "ok" lines, 140 passed.
   (cd speak-to-sign/crates/voice-verifier && cargo test 2>&1 | grep 'test result')
   # See: 7 notes:: tests ok, the summary rules of README step 2.
   (cd speak-to-sign/crates/voice-verifier && cargo test --test ops notes:: 2>&1 | grep '^test')
   # See: 47 passed.
   (cd speak-to-sign/demo/contracts/community-notes && cargo test -p community-notes 2>&1 | grep 'test result')
   # See: 4 tests ok in a local nearcore sandbox, after build.sh makes the WASM.
   # One of them is the_moderator_hides_a_note.
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
   # See: 6 lines that start with "✔ a", then "ℹ pass 56" and "ℹ fail 0".
   # One line: "a verdict for one community note does not pass for another note".
   (cd speak-to-sign/packages/voice-verdict && pnpm install --frozen-lockfile >/dev/null && pnpm test 2>&1 | grep -E '^✔ a (step-up |verdict)|^ℹ (pass|fail)' | sed 's/ ([0-9.]*ms)//')
   ```

3. The active verifier comes from this source. Build commit `a816798` in
   Docker, then read the active version on OutLayer.

   ```bash
   # See: sha256 bfe81633b9ed596df239201f153a84c860d71ddd8edf713c1c785ef2b7c1c946
   (cd speak-to-sign && git checkout --quiet a816798 && crates/voice-verifier/build.sh --docker 2>&1 | tail -1; git checkout --quiet dev)
   # See: the same hash (verifier 0.12.0).
   curl -s https://rpc.testnet.fastnear.com -H 'Content-Type: application/json' -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"query\",\"params\":{\"request_type\":\"call_function\",\"finality\":\"final\",\"account_id\":\"outlayer.testnet\",\"method_name\":\"get_project\",\"args_base64\":\"$(printf '%s' '{"project_id":"seams-v1.testnet/voice-verifier"}' | base64 | tr -d '\n')\"}}" | jq -r '.result.result | implode | fromjson | .active_version'
   ```

   The demo does not call the active version. The demo signs through the
   Seams staging server, and that server calls verifier 0.13.0
   (`1b777154…`, not active) by its `version_key`: see
   `speakToSignVerifier` in
   [`deployment/wallet-system/targets.json`](https://github.com/seams-tech/seams-monorepo/blob/6fea502cb5873c8d44b837dd7bdb9d12e19ecd05/deployment/wallet-system/targets.json#L249)
   of seams-monorepo. Verifier 0.13.0 also comes from this source:

   ```bash
   # See: sha256 1b7771544f3bcf5b3ba9e9bf3ac611f6abad21e7538f67b2666fd8aafc8cf930
   (cd speak-to-sign && git checkout --quiet a4d6ce7 && crates/voice-verifier/build.sh --docker 2>&1 | tail -1; git checkout --quiet dev)
   ```

4. The deployed notes contract is the reproducible build of commit `777b844`.

   ```bash
   # See: mvYopouU7PP9ZVbwzTJ6qUH8kDjEiMeP7TDENF9eUko
   curl -s https://rpc.testnet.fastnear.com -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"query","params":{"request_type":"view_account","finality":"final","account_id":"notes.seams-v1.testnet"}}' | jq -r .result.code_hash
   # See: git+https://github.com/seams-tech/speak-to-sign?rev=777b84429096604e77e217480e9f89a398f5da13
   curl -s https://rpc.testnet.fastnear.com -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"query","params":{"request_type":"call_function","finality":"final","account_id":"notes.seams-v1.testnet","method_name":"contract_source_metadata","args_base64":"e30="}}' | jq -r '.result.result | implode | fromjson | .build_info.source_code_snapshot'
   ```

   The code hash is the base58 form of the SHA-256 `0b821a5c…7f80`, the
   reproducible build of `777b844`. SourceScan built that commit again and
   got the same code hash, so NearBlocks shows the code as verified
   (<https://testnet.nearblocks.io/address/notes.seams-v1.testnet/contract>). To build
   it yourself, see README step 4 (Docker and cargo-near 0.22.0).
   `demo/contracts/community-notes/reproducible.sha256` now holds
   `596beeb3…d9c3`, the build of `119ef0e`. That build is not deployed yet.
   Of the other three demo contracts, the note market and the faucet run
   builds of `777b844` too, and the voice multisig runs the build of
   `99231f6`. SourceScan verified all of them (`demo/contracts/README.md`).

5. NEAR AI's gateway runs in an Intel TDX VM, and the TLS of
   `cloud-api.near.ai` ends inside that VM. The gateway's TDX quote names its
   TLS key: the report data of the quote is SHA-256(gateway key || SHA-256 of
   the TLS public key), then your nonce. No API key is necessary. You also
   need `openssl` and `xxd`.

   ```bash
   N=$(openssl rand -hex 32); curl -s "https://cloud-api.near.ai/v1/attestation/report?model=openai/whisper-large-v3&signing_algo=ed25519&include_tls_fingerprint=true&nonce=$N" > nearai.json
   # See: two equal lines of 128 hex characters. The last 64 are your nonce.
   jq -r .gateway_attestation.intel_quote nearai.json | cut -c1137-1264
   echo "$(jq -r '.gateway_attestation | .signing_address + .tls_cert_fingerprint' nearai.json | xxd -r -p | shasum -a 256 | cut -c1-64)$N"
   # See: two equal lines (73862c25…a5ad on 2026-11-12): the key of the TLS
   # connection that you open, and the key that the quote names.
   echo | openssl s_client -connect cloud-api.near.ai:443 -servername cloud-api.near.ai 2>/dev/null | openssl x509 -pubkey -noout | openssl pkey -pubin -outform DER | shasum -a 256 | cut -c1-64
   jq -r .gateway_attestation.tls_cert_fingerprint nearai.json
   ```

   These lines do not check the signature of the quote to Intel, and the
   verifier does not check NEAR AI's attestation (see
   [Not covered](#not-covered)).

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
| With the verdict of this note, Wallet core signs one `add_note` and nothing more. | In the dependency, at 0.69.2: [`signNoteWithVerdict`](https://github.com/seams-tech/seams-wallet/blob/e9fdc65ae8ae269499dfce423412e446a87d3f0d/packages/wallet/src/core/transactionFeatures/hostOperations.ts#L197) and its [test](https://github.com/seams-tech/seams-wallet/blob/e9fdc65ae8ae269499dfce423412e446a87d3f0d/tests/unit/speakToSignHost.unit.test.ts#L1118) |
| The voice multisig contract checks the verdict on chain: key, expiry, owner, commitment. Each approval is a verdict too: no admin, no plain approve, one recording counts once, M of N to execute. Version 3.0.0 is on `voice-multisig.seams-v1.testnet`; no proposal ran there yet. | `a_verdict_of_another_key_fails`, `an_expired_verdict_fails`, `a_verdict_for_another_commitment_fails`, `a_plain_approve_without_a_verdict_fails`, `a_verdict_of_a_non_signer_fails`, `the_same_verdict_twice_fails`, `one_recording_for_two_signers_fails`, `an_approval_for_another_commitment_fails`, `execute_below_the_threshold_fails` in `demo/contracts/voice-multisig/src/tests.rs` |
| The note market takes a bet only with the verdict of that bet: the key, the expiry, and the bettor, market, side and amount. Each verdict counts once. On testnet, `get_voice_config` of `pm-notes.seams-v1.testnet` gives `"required":true`. | `a_spoken_bet_with_its_verdict_is_taken_once`, `a_bet_without_a_verdict_is_refused`, `a_verdict_is_for_one_account_market_outcome_and_amount`, `a_verdict_of_another_key_is_refused`, `an_old_verdict_is_refused`, `a_changed_verdict_is_refused`, `a_verdict_passes_only_once` in `demo/contracts/jev-prediction-market/src/tests.rs` (7 passed on 2026-11-12); `a_bet_needs_the_verdict_of_its_own_spoken_sentence` in `sandbox/tests/spoken_bet.rs` |
| A sealed recording opens only for its owner and operation. | `sealed_audio_opens_only_for_its_owner_and_operation` in `crates/voice-verifier/tests/ops/sealed.rs`; spec 5.1 |
| The active verifier (0.12.0) and the verifier that the demo calls (0.13.0) come from this source. | Check 3 above; `crates/voice-verifier/README.md`, "Reproducible build" |
| The TLS of `cloud-api.near.ai` ends in NEAR AI's gateway: the gateway's TDX quote names its TLS key and your nonce. The signature of that quote is not checked here. | Check 5 above |

## Not covered

From [`docs/architecture.md`](docs/architecture.md) section 8, "Trust
boundaries", spec section 11, and the READMEs of the contracts:

- A voice clone works only on the person's own device, with the Wallet
  unlocked: VoiceID runs in the Wallet's isolated iframe on that device, and
  the keys stay there. An attacker needs that device in hand (or malware
  that controls it) and an unlocked Wallet, and with those, the attacker can
  do much more harm than a voice clone. On that device, this build has no
  liveness check and no fresh words, and only a NEAR transfer above 10 NEAR
  also needs a passkey.
- A text-to-speech voice can enroll and pass. The verifier does not detect
  synthetic speech, and it does not refuse one voice on many accounts.
- NEAR AI does not sign the transcript. A false transcript of the NEAR AI
  gateway or of Whisper can pass the word check.
- The owner of the OutLayer project can deploy new code that signs with the
  same key. The Wallet pins the key, not the code.
- The Phala app owner can change the speaker service and keep its key.
- The device seals each recording. After that, only TEEs open it: the
  OutLayer worker (Intel TDX), the speaker service in a Phala dstack VM
  (Intel TDX), and NEAR AI's gateway and Whisper, each in an Intel TDX VM on
  dstack. The report of the Whisper VM also has NVIDIA GPU evidence; nobody
  here checks it. The verifier pins the key of the Phala service from its
  TDX attestation. It does not check NEAR AI's attestation: it sends the
  recording over HTTPS to `cloud-api.near.ai`, whose TLS key the gateway's
  quote names (check 5), but it does not check that. Not checked: the code
  that NEAR AI's VMs run, and how the gateway reaches Whisper.
- The verifier does not check a proof of the NEAR RPC access-key view at
  enrollment.
- Each of the four demo contract accounts still has a full-access key. Its
  holder can deploy new code, or name another moderator of the notes
  contract.
- The OutLayer worker of the note market (`demo/contracts/jev-prediction-market/resolver`)
  has no reproducible build. The four demo contracts and the verifier have
  one.
- Testnet only.

## Future improvements

These steps answer the first two limits above:

- **Liveness.** The verifier asks for fresh words, which it picks at random,
  so that a recording made before the request does not pass.
- **Synthetic-speech detection.** An anti-spoofing model runs in the TEE next
  to the speaker check, and refuses audio that a text-to-speech or
  voice-conversion model made.
- **Sybil voice detection.** At enrollment, the TEE compares the new voice
  with the voices that are already enrolled. It refuses a voice that is
  already on another account. The templates stay sealed in the TEE, so no
  voiceprint leaves it.
