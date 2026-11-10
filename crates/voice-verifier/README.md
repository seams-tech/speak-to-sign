# seams-voice-verifier

OutLayer worker (`wasm32-wasip2`) for Speak-to-Sign (plan
`seams-wallet/docs/refactor-227-speak-to-sign-without-passkey.md`). The Seams
verify route calls it with
`POST https://testnet-api.outlayer.ai/call/seams-v1.testnet/voice-verifier`.
Operations: `enroll` and `verify`. No `tract`, no ReDimNet in the worker.

The verdict authorizes a payment from the owner's own account: the Wallet
checks it against the key that it pins and signs the transaction itself.
There is no vault contract.

## Versions

The source on this branch is version 0.7.0 (`config::VERIFIER_VERSION`). The
sections below say when a feature needs a later version than 0.3.1.

| Version | OutLayer version key (WASM SHA-256)                                | State                                                                                                                                                 |
| ------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0.3.0   | `09f4ce1b…` (330,322 bytes, commit `3dab63d`)                      | Replaced. Verdict v2, the policy step, the `AccountTransfer` request, NEP-413 enrollment and `template:v3:<owner>`. It removed the vault.             |
| 0.3.1   | `5b6fad5df11440847e13508f57736da8de371526824cf12178dfc20be2c9c1d1` | Replaced. 334,704 bytes, commit `446882b`. It adds the forgiving word check for a send sentence. |
| 0.4.0   | `8a0b7ba0dff61a4b45e5d1d164c011525e11fe9f4fd02a4e22368882447329ef` | Built and added to the OutLayer project on 2026-11-09. **Not active**: a call reaches it only if the caller sets `version_key`. It adds `community_note` and `note_rating`. Transfers are unchanged. |
| 0.5.1   | `cdb46fea7fab5afbb855e373674c80a9cd77170beb594579da28d754009e7258` | Replaced on 2026-11-09 at 17:04 UTC (365,426 bytes, `build.sh --docker`, FastFS tx `A4zDd9E6sm1ZjSj3uVukTcTnoYZG83ntv1DqnS7A9w8R`, `add_version` tx `BGZ3QRPGaUzJ4x3Z7wcNq3yJ3xMYnAwS3rnPQfY69MTb`). It writes the used-audio mark during the requests (0.16–0.20 s off each `verify`) and times the responses between the storage calls. It includes the merge approvals of 0.5.0. The Mac build of the same source was `aae02d5e…`. |
| 0.5.2   | `96b79b518613a50538b060da2279c91e12b0619499c532c2708f61ddb790d7e5` | **Active** since 2026-11-09 at 17:04 UTC (373,865 bytes, `build.sh --docker`, FastFS tx `7zwppPbVm5AMmFQ18m9dWCYax4mA4zTrHupVnuhQpFnD`, `add_version` tx `A81vUiuvEdsCyFKrFwzZdQe3gVfFTXuse5ue4Qi5g7L2`). No change in behaviour: the code is reorganised. The signed output is the same as 0.5.1, except the version. |
| 0.6.0   | `566e8cbc874b92a805d84360e6bab5c4f1c5b4eb276b518a207142be06fefbc9` | Added to the OutLayer project on 2026-11-10 (396,771 bytes, `build.sh --docker`, FastFS tx `5VUpXWs653GegtePhTHYsc4TRUgzEXP5cKC2ZUmg4V9M`, `add_version` tx `EZjs5T1yY859sb2moQkjHYeFyyh8qLrXycV11YdKyqb4`). **Not active**: a call reaches it only if the caller sets `version_key`. It adds `multisig_propose` and `multisig_confirm` for the voice multisig demo. The other kinds are unchanged, except the version in the verdict. |
| 0.6.1   | `f56ba0e8942a5fcd1b2ed500bf9013953bccefb22b375c2830c2b0a01508e7cb` | Added to the OutLayer project on 2026-11-10 (397,623 bytes, `build.sh --docker`, FastFS tx `7sWJVYsV1Fkdmq4sW1GDZRE47w89L64NJwfL38AoGh5Q`, `add_version` tx `81nFKGTvg2DBgcTW6YN2YfUF57qDS1bBcXsEK5qJCE51`). **Not active**: the voice multisig route selects it by `version_key`. In a multisig proposal of a transfer, the send part gets the send-sentence forgiveness: "point" for "dot", "dash" left out or said as "hyphen", and the receiver matched by sound. A confirmation keeps the exact words. The other kinds are unchanged, except the version in the verdict. |
| 0.7.0   | not built for OutLayer yet | The source on this branch. It adds `multisig_hide_note` for the voice multisig page ("hide note N"). The other kinds are unchanged, except the version in the verdict. Build it with `build.sh --docker`, add it to the OutLayer project, and set its hash as `VOICE_OUTLAYER_VERSION_KEY` of the demo site. |

The transaction hashes of the FastFS upload and of `add_version` for 0.4.0 are
in the repository README.

## Build and test

```sh
cargo test           # native tests (fake host), and the shared vectors
./build.sh           # release WASM, size and SHA-256; fails at 1,000,000 bytes
./build.sh --docker  # the same build in the pinned x86_64 Linux image
```

`build.sh` honors `CARGO_TARGET_DIR`. `rust-toolchain.toml` pins Rust 1.97.1
with the `wasm32-wasip2` target. rustup installs it on the first call.

## Reproducible build

The OutLayer version key is the SHA-256 of the WASM. So you can check that a
version comes from this source: build it and compare the hash.

One commit gives the same bytes in any folder and on any machine of the same
host platform. The reference platform is x86_64 Linux
(`x86_64-unknown-linux-gnu`). On such a machine, run this from the root of
the clone:

```sh
crates/voice-verifier/build.sh
```

On any machine with Docker, run this. On a Mac with Apple silicon, Docker
runs the x86_64 image under emulation. After the image download, the build
takes about 40 s.

```sh
crates/voice-verifier/build.sh --docker
```

Expected for the source of version 0.6.1:

```text
host   x86_64-unknown-linux-gnu
bytes  397623
sha256 f56ba0e8942a5fcd1b2ed500bf9013953bccefb22b375c2830c2b0a01508e7cb
```

A change to the source of this crate or of `spoken-intent`, to
`../Cargo.lock` or to `build.sh` gives another hash. Deploy the WASM of
`./build.sh --docker`, so that its version key can be built again.

These things make the bytes the same:

- `rust-toolchain.toml` pins the compiler. `../Cargo.lock` pins the crates.
- `../Cargo.toml` is the workspace root. Cargo hashes the path of each path
  dependency into the symbol names: a path below the workspace root as a
  relative path, any other path as an absolute one. With this root,
  `../spoken-intent` is a relative path.
- `build.sh` remaps the local folders that rustc writes into panic locations:
  the clone to `/speak-to-sign`, `CARGO_HOME` to `/cargo`, and the rust-src of
  the toolchain to `/rustc/<commit>`. It replaces any `RUSTFLAGS`.

The host platform changes the bytes. The Cargo hash of each crate that uses a
build script or a procedural macro (for example `serde` and `sha2`) is
different on each host platform. So macOS on arm64 gives
`79ca912f376f4859ff77cc7152c3cd7be391c32db18d56ec3746e70f7e7f1fea`, and Linux
on arm64 gives another hash. A Cargo config with `[profile.release]`
settings, for example in `~/.cargo/config.toml`, also changes the bytes.

Checks on 2026-11-10, each from a fresh clone:

| Build                                                                                     | Host                       | SHA-256     |
| ----------------------------------------------------------------------------------------- | -------------------------- | ----------- |
| `build.sh` in two clones on macOS 15.7.1: one with rust-src, one in a folder with a space | `aarch64-apple-darwin`     | `79ca912f…` |
| `build.sh --docker` from the same two clones                                              | `x86_64-unknown-linux-gnu` | `cdb46fea…` |
| `build.sh` with a fresh rustup and rust-src, another `CARGO_HOME`, a folder with a space  | `x86_64-unknown-linux-gnu` | `cdb46fea…` |

The versions up to 0.5.1 in the Versions table were built on a Mac before
these changes. Their version keys depend on the folders of that Mac, so
another machine cannot build them again.

## Services

- Speaker: ReDimNet B1 in a Phala dstack CVM (`config::SPEAKER_HOST`). Each
  embedding is signed; the worker checks the signature, the nonce, the audio
  digest, the model digest and the pinned key `config::SPEAKER_PINNED_KEY_HEX`.
- Words: Whisper large-v3 on NEAR AI Cloud. Secret `NEAR_AI_API_KEY`.
- NEAR RPC: `https://test.rpc.fastnear.com` (`config::NEAR_RPC_URL`), for the
  owner's access key at enrollment only.
- `verify` sends both requests at once (`wasi:http`, one poll loop).

## Overlap of network and storage

The OutLayer storage functions are blocking host calls. So each operation
starts its HTTPS requests and sends their bodies first (`Host::post_start`),
then makes its storage calls, then polls the responses (`Host::post_wait`).
The host carries the requests during the storage calls. A storage refusal
(`template_missing`, `audio_reused`, `storage`) drops the requests
(`Host::post_cancel`); a reused recording can thus cost one NEAR AI call.

`verify` reads the template, then writes the used-audio mark with one atomic
set-if-absent, while the requests are in flight (0.5.1 and later). So the
mark is off the critical path, and a reused recording is refused by the same
write. A refusal or a service outage after the mark also uses up the
recording; the Wallet records new audio for each try. An owner without a
template uses up nothing. Between the two storage calls, `Host::post_poll`
takes the responses that are ready, so their times do not include the mark.

Stage times (`ms`, not signed), in ms:

| Field        | `verify` | `enroll` | Meaning                                                            |
| ------------ | -------- | -------- | ------------------------------------------------------------------ |
| `decode`     | yes      |          | input, request digests, WAV decode, energy gate                    |
| `send`       | yes      | yes      | start the requests and send the bodies                             |
| `storage`    | yes      | yes      | `verify`: template read and used-audio mark, during the requests   |
| `wait`       | yes      | yes      | the rest of the network time after the storage calls               |
| `parallel`   | yes      | yes      | start of the requests to the last response (send + storage + wait) |
| `speaker`    | yes      | yes      | speaker service response (`enroll`: the slowest of three)          |
| `transcribe` | yes      |          | NEAR AI response (at most the template read late)                  |
| `redimnet`   | yes      |          | the service's own model time                                       |
| `rpc`        |          | yes      | NEAR RPC access-key view response                                  |
| `mark`       | yes      |          | used-audio write, inside `storage`                                 |
| `policy`     | yes      |          | the policy step                                                    |
| `write`      |          | yes      | used-audio writes and the template write                           |
| `sign`       | yes      |          | verdict signature                                                  |
| `total`      | yes      | yes      | the whole operation                                                |

## Inputs

- `enroll`: `{"op":"enroll","owner","audio_wav_b64":[3 WAVs],"authorization":{"public_key","signature_b64","nonce_b64"}}`.
- `verify`: `{"op":"verify","owner","request":{"kind":"transfer","receiver","amount_yocto"},"contacts":[...],"audio_wav_b64"}`.
  - `request` is tagged by `kind`:
    - `transfer`: a native NEAR transfer from `owner` to `receiver`, as
      `spoken_intent::SpokenRequestV1::AccountTransfer`. The receiver must be
      a named account that the text can say, and not the owner.
    - `community_note` (0.4.0 and later):
      `{"contract","post_id","note_sha256_hex","summary"}`, as
      `SpokenRequestV1::CommunityNote`. The owner says only the summary:
      1 to 12 words of ASCII letters (`spoken_intent::SpokenSummary`). The
      note is bound by its SHA-256 (64 lowercase hex characters).
    - `note_rating` (0.4.0 and later): `{"contract","note_id","rating"}` with
      `rating` `helpful`, `somewhat_helpful` or `not_helpful`, as
      `SpokenRequestV1::NoteRating`. The owner says "this note is helpful",
      "this note is somewhat helpful" or "this note is not helpful".
    - `merge_approval` (0.5.0 and later):
      `{"contract","repo_sha256_hex","pull_request","base","head_commit_hex"}`,
      as `SpokenRequestV1::MergeApproval`. The owner says "merge pull request
      <number> into <base>", for example "merge pull request forty two into
      main". `pull_request` is 1 or more. `base` is 1 to 32 ASCII lowercase
      letters (`spoken_intent::SpokenBranch`). The repository is bound by the
      SHA-256 of its name (64 lowercase hex characters) and the head commit
      by its 20-byte id (40 lowercase hex characters). It moves no value: the
      Wallet calls only `approve_merge`, with no deposit. Any other value
      refuses with `unsupported`.
    - `multisig_propose` (0.6.0 and later):
      `{"multisig","proposal_id","receiver","amount_yocto"}`. The proposer
      says "approve proposal <id>, send <amount> NEAR to <receiver>". The
      worker draws a 32-byte salt and builds
      `SpokenRequestV1::MultisigApproval`. Its request digest binds the
      salted commitment, not the proposal (`spoken_intent::multisig_approval_digest`).
      On an accept the worker stores the proposal and the salt, and the
      output has `"multisig":{"commitment","salt"}` (base64url) and no stage
      times, so that it stays below 1,024 bytes.
    - `multisig_hide_note` (0.7.0 and later):
      `{"multisig","proposal_id","note_id"}`, with `note_id` 1 or more. The
      proposer says "approve proposal <id>, hide note <note id>" with the
      exact words. Like `multisig_propose`, the worker draws the salt,
      stores the proposal (`{"proposal_id","note_id","salt_hex"}`) and
      returns the commitment and the salt. The near misses are the note id
      one lower, one higher, and with each digit changed.
    - `multisig_confirm` (0.6.0 and later):
      `{"multisig","proposal_id","commitment_hex"}`. Another member says the
      same sentence from memory: the input does not hold the proposal. The
      worker loads it by the commitment and refuses `proposal_missing` if it
      has none under that id. The verdict of a refusal has no
      `spoken_text_digest` and no `word_margin_milli`, and no output of a
      confirmation holds the salt. Three `words` refusals of one member for
      one proposal give `attempts_exhausted`; only refusals after the
      speaker check passed count. A voice that passes against another
      member who already said the proposal refuses `same_speaker`.
    - The contract `demo/contracts/voice-multisig` checks each verdict of
      these kinds on chain. `Transfer` and `HideNote` proposals exist. A
      0.6 record of a transfer still reads in 0.7.0.
  - The words must match the rendered text of the request. A rating and a
    merge approval need the exact words. Two kinds of forgiveness exist;
    each applies to words that hold no value:
    - Send sentence (0.3.1 and later; `spoken-intent` commit `92c21bc`,
      `976167297` in seams-wallet): the
      first word "sent" or "sends" counts as "send"; a closed list of
      sound-alikes of "near" and of "testnet" counts as the word itself; a
      number sound-alike counts as the number word in the amount slot; and a
      receiver one sound from a known account (the receiver or a contact)
      counts as that account. The amount and the receiver are still compared
      with the request. Negations, other units and added clauses are refused.
    - Multisig proposal of a transfer (0.6.1 and later): in "approve
      proposal <number> send …", the send part gets the same forgiveness. So
      "seams grants point testnet" and "seams dash grants dot testnet" both
      count as `seams-grants.testnet`. A confirmation (`multisig_confirm`)
      adds no receiver to the known accounts: a match by sound would write
      the hidden receiver into `heard`. Its send part gets only the verb,
      amount and unit rules.
    - Community note summary (0.4.0 and later): a summary of 4 or more words
      also passes with one word changed or dropped, when the heard words are
      still closer to the summary than to every near miss (an added or dropped
      "not" never passes).
  - `contacts`: at most 32 named accounts that the owner knows, for the
    account names and the confusion set. The receiver is added if missing,
    except for `multisig_confirm`.
- Unknown fields are refused at every level.
- WAV: 16 kHz mono PCM16, at most 8 s, standard base64. The worker writes it
  again with a 44-byte header (the canonical WAV); the audio digest is the
  SHA-256 of the canonical WAV.

## Policy step

After the speaker and the words pass, `policy::decide` can only tighten the
decision: an accept becomes a `step_up`, and the Wallet then asks for a fresh
passkey as well. A plain-English policy engine plugs in here later. Today one
fixed rule stands in for it:

| Rule id                           | Text                                             |
| --------------------------------- | ------------------------------------------------ |
| `stub_voice_amount_above_10_near` | A voice payment above 10 NEAR needs a passkey.   |

Exactly 10 NEAR is allowed. A step-up still marks the audio used.

## Signed verdict

`verify` returns `{"kind":"seams_voice_verify_output_v2","verdict_json","signature_b64","public_key","policy_text","ms","detail"}`.

- `verdict_json` (a string) is the only signed object: compact JSON with 13
  fields, always all present, in this order: `kind`
  (`seams_voice_signed_verdict_v2`), `renderer` (`spoken-intent/1`),
  `verifier`, `request_digest`, `spoken_text_digest`, `audio_digest`,
  `outcome` (`accept`, `step_up` or `refuse`), `reason` (only on `refuse`),
  `policy_rule` (the rule id, only on `step_up`), `expires_at_ms`,
  `speaker_score_milli`, `word_margin_milli`, `heard`.
- `expires_at_ms`: the worker wall clock read before signing, plus 120 s
  (`config::VERDICT_TTL_MS`), in ms since the UNIX epoch. Every verdict has
  it. The Wallet refuses a verdict after it.
- The signed message is
  `SHA-256("seams:outlayer:voice-verdict:v2" || verdict_json bytes)`, signed
  by the manifest key `verdict` (`bind: "project"`). The keystore derives that
  key from the project and the caller; over HTTPS the caller is the
  payment-key owner, so the Wallet's pinned key holds only for runs that the
  Seams payment key pays for. The key stays the same across versions. The
  testnet key is `ed25519:E8E53ydtc9LRvVz9xBCRrSzyBa5nh1gK1ts53Aoo751U`. Wallet
  core pins it and refuses a verdict of any other key.
- `policy_text` (not signed): the sentence of the rule on `step_up`, else
  `null`.
- The output stays below 1,024 bytes; `heard` is cut to fit.

## Owner-authorized enrollment

The owner signs one NEP-413 message with a full-access key of the owner
account. The Wallet does this with its NEP-413 signing path.

- `enrollment_digest = base64url-no-pad SHA-256("seams:voice-enrollment:v2"
  || owner || 0x00 || d1 || d2 || d3)`, where `d1..d3` are the raw 32-byte
  SHA-256 digests of the three canonical WAVs, in input order.
- NEP-413 payload: `message = "Speak-to-Sign voice enrollment " +
  enrollment_digest`, `recipient = "seams-v1.testnet/voice-verifier"`,
  `nonce` = the 32 bytes of `nonce_b64`, `callback_url = None`.
- `hash = SHA-256(u32 LE 2147484061 || borsh(message, nonce, recipient,
  callback_url))`; the signature is ed25519 over these 32 bytes.

`enroll` computes the digest from the audio it received and checks the
signature before any network call. A bad key, signature or nonce refuses
with `not_authorized` and no network call. Then it reads
`view_access_key(owner, public_key)` (finality `final`) over NEAR RPC in the
same batch as the three speaker calls. A function-call key or an unknown key
refuses with `not_authorized`; an RPC failure with
`authorization_unavailable`. Then no audio is marked used and no template is
written. A re-enrollment with a new authorization replaces the template
(compare-and-swap) and adds 1 to its epoch.

The output is `seams_voice_enrollment_v3`: `owner`, `outcome`, `reason`,
`agreement_milli`, `audio_digests`, `enrollment_digest`, `template_epoch`,
`verifier_public_key`, `ms`, `detail`.

Trust note: the verifier trusts `test.rpc.fastnear.com` for the access-key
view. It does not check a proof of the view result. An RPC operator that lies
can let the holder of any key enroll (or re-enroll) a voice for an owner, or
can block enrollment. Such a template then decides later verdicts.

## Shared vectors

The Wallet's TypeScript tests read these files. Tests in this crate write
them (set `SEAMS_WRITE_VECTOR=1`, or delete a file, and run `cargo test`) and
check that they match what the verifier computes. The test keys are for tests
only.

- `testdata/signed_verdict_v2.json` (`tests/signed_vector.rs`): `domain`,
  `test_seed_hex`, `public_key`, `public_key_hex`, and `verdicts`, a list of
  named cases (`accept` for 2 NEAR, `step_up` for 11 NEAR), each with
  `request` (`kind`, `network`, `owner`, `receiver`, `amount_yocto`),
  `request_borsh_hex`, `spoken_text`, `request_digest`, `spoken_text_digest`,
  `audio_digest`, `outcome`, `policy_rule`, `policy_text`, `expires_at_ms`,
  `verdict_json`, `message_sha256_hex` and `signature_b64`.
- `testdata/enrollment_digest_v2.json` (`tests/enrollment_vectors.rs`):
  `domain`, `owner`, `audio_digests` (base64url), `enrollment_digest`.
- `testdata/enrollment_authorization_v1.json` (`tests/enrollment_vectors.rs`):
  `test_seed_hex` (bytes 1 to 32), `public_key`, `owner`,
  `enrollment_digest`, `message`, `recipient`, `nonce_b64`, `nep413_tag`,
  `nep413_hash_hex`, `signature_b64`.

## Storage (the payment-key owner's cell)

- `template:v3:<owner>`: keystore-encrypted,
  `SVT1 || epoch || ReDimNet SHA-256 || 192 f32 LE`. Replaced only by an
  authorized re-enrollment, which adds 1 to the epoch. The earlier
  `template:v2:<vault>:<owner>` records are not read, so each owner enrolls
  again once.
- `audio:v2:<digest>`: raw used-audio marker.
- `msig1:<multisig>:<commitment b64u>:open`: keystore-encrypted JSON
  `{proposal_id, receiver, amount_yocto, salt_hex}` of a multisig proposal.
- `msig1:<multisig>:<commitment b64u>:voices`: JSON array of the owners whose
  multisig verdict was an accept.
- `msig1:<multisig>:<commitment b64u>:tries:<owner>`: the decimal count of
  `words` refusals of that owner.

## Vendored crate

`vendor/bit-vec` is kept for `voice-probe`, which patches to it.
