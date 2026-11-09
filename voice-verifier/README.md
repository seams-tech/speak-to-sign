# seams-voice-verifier

OutLayer worker (`wasm32-wasip2`) for Speak-to-Sign (plan
`seams-wallet/docs/refactor-227-speak-to-sign-without-passkey.md`). The Seams
verify route calls it with
`POST https://testnet-api.outlayer.ai/call/seams-v1.testnet/voice-verifier`.
Operations: `enroll` and `verify`. No `tract`, no ReDimNet in the worker.

The verdict authorizes a payment from the owner's own account: the Wallet
checks it against the key that it pins and signs the transaction itself.
There is no vault contract.

## Build and test

```sh
cargo test          # native tests (fake host), and the shared vectors
./build.sh          # release WASM, size and SHA-256; fails at 1,000,000 bytes
```

`build.sh` honors `CARGO_TARGET_DIR`.

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
then makes its storage reads, then polls the responses (`Host::post_wait`).
The host carries the requests during the storage calls. A storage refusal
(`template_missing`, `audio_reused`, `storage`) drops the requests
(`Host::post_cancel`); a reused recording can thus cost one NEAR AI call.
The used-audio mark is written only after a decision, as before.

Stage times (`ms`, not signed), in ms:

| Field        | `verify` | `enroll` | Meaning                                                            |
| ------------ | -------- | -------- | ------------------------------------------------------------------ |
| `decode`     | yes      |          | input, request digests, WAV decode, energy gate                    |
| `send`       | yes      | yes      | start the requests and send the bodies                             |
| `storage`    | yes      | yes      | template read and used-audio check, during the requests            |
| `wait`       | yes      | yes      | the rest of the network time after the storage calls               |
| `parallel`   | yes      | yes      | start of the requests to the last response (send + storage + wait) |
| `speaker`    | yes      | yes      | speaker service response (`enroll`: the slowest of three)          |
| `transcribe` | yes      |          | NEAR AI response                                                   |
| `redimnet`   | yes      |          | the service's own model time                                       |
| `rpc`        |          | yes      | NEAR RPC access-key view response                                  |
| `mark`       | yes      |          | used-audio write, after the decision                               |
| `policy`     | yes      |          | the policy step                                                    |
| `write`      |          | yes      | used-audio writes and the template write                           |
| `sign`       | yes      |          | verdict signature                                                  |
| `total`      | yes      | yes      | the whole operation                                                |

## Inputs

- `enroll`: `{"op":"enroll","owner","audio_wav_b64":[3 WAVs],"authorization":{"public_key","signature_b64","nonce_b64"}}`.
- `verify`: `{"op":"verify","owner","request":{"kind":"transfer","receiver","amount_yocto"},"contacts":[...],"audio_wav_b64"}`.
  - `request` is tagged by `kind`. Today only `transfer` exists: a native
    NEAR transfer from `owner` to `receiver`, as
    `spoken_intent::SpokenRequestV1::AccountTransfer`. The receiver must be a
    named account that the text can say, and not the owner.
  - `contacts`: at most 32 named accounts that the owner knows, for the
    account names and the confusion set. The receiver is added if missing.
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
  Seams payment key pays for.
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

## Vendored crate

`vendor/bit-vec` is kept for `voice-probe`, which patches to it.
