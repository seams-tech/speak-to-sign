# seams-voice-verifier

OutLayer worker (`wasm32-wasip2`) for Refactor 210, HTTPS path (plan
`seams-monorepo/docs/refactor-210-voice-intents.md`, Sections 7.5 and 11.5).
The Wallet calls it with
`POST https://testnet-api.outlayer.ai/call/seams-v1.testnet/voice-verifier`.
Operations: `enroll` and `verify`. No `tract`, no ReDimNet in the worker.

## Build and test

```sh
cargo test          # native tests (fake host), and the shared signed vector
./build.sh          # release WASM, size and SHA-256; fails at 1,000,000 bytes
```

## Services

- Speaker: ReDimNet B1 in a Phala dstack CVM (`config::SPEAKER_HOST`). Each
  embedding is signed; the worker checks the signature, the nonce, the audio
  digest, the model digest and the pinned key `config::SPEAKER_PINNED_KEY_HEX`.
- Words: Whisper large-v3 on NEAR AI Cloud. Secret `NEAR_AI_API_KEY`.
- NEAR RPC: `https://test.rpc.fastnear.com` (`config::NEAR_RPC_URL`), for the
  enrollment authorization only.
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

| Field        | `verify` | `enroll` | Meaning                                                        |
| ------------ | -------- | -------- | -------------------------------------------------------------- |
| `decode`     | yes      |          | input, request digests, WAV decode, energy gate                |
| `send`       | yes      | yes      | start the requests and send the bodies                         |
| `storage`    | yes      | yes      | template read and used-audio check, during the requests        |
| `wait`       | yes      | yes      | the rest of the network time after the storage calls           |
| `parallel`   | yes      | yes      | start of the requests to the last response (send + storage + wait) |
| `speaker`    | yes      | yes      | speaker service response (`enroll`: the slowest of three)      |
| `transcribe` | yes      |          | NEAR AI response                                               |
| `redimnet`   | yes      |          | the service's own model time                                   |
| `rpc`        |          | yes      | NEAR RPC view response                                         |
| `mark`       | yes      |          | used-audio write, after the decision                           |
| `write`      |          | yes      | used-audio writes and the template write                       |
| `sign`       | yes      |          | verdict signature                                              |
| `total`      | yes      | yes      | the whole operation                                            |

## Owner-authorized enrollment

The owner first calls the vault's `authorize_enrollment(enrollment_digest)`.
The vault keeps one pending digest for each owner for 10 minutes, and a new
call replaces it. The view `get_pending_enrollment(owner_id)` returns it, or
`null` after the expiry.

`enrollment_digest = base64url-no-pad SHA-256("seams:voice-enrollment:v1" ||
vault || 0x00 || owner || 0x00 || d1 || d2 || d3)`, where `d1..d3` are the
raw 32-byte SHA-256 digests of the three canonical WAVs, in input order.
`testdata/enrollment_digest_v1.json` is the shared vector; the vault's tests
and `demo/test_demo.py` read it.

`enroll` computes the digest from the audio it received. It reads the
vault's pending digest with a JSON-RPC `query` (`call_function`, finality
`final`) in the same batch as the three speaker calls. It refuses with
`not_authorized` if there is none or it differs, and with
`authorization_unavailable` if the RPC call fails. Then no audio is marked
used and no template is written. With a fresh authorization, a re-enrollment
replaces the template (compare-and-swap) and adds 1 to its epoch. The vault
does not learn the result.

Trust note: the verifier trusts `test.rpc.fastnear.com` for this one read.
It does not check a proof of the view result. An RPC operator that lies can
let a payment-key holder enroll (or re-enroll) a voice without the owner's
authorization, or can block enrollment. Such a template then decides later
verdicts. It cannot move funds alone: `transfer_with_verdict` needs a
transaction from the owner's own key, and the vault still checks each verdict
signature, request digest and audio digest.

## Inputs

- `enroll`: `{"op","vault","owner","audio_wav_b64":[3 WAVs]}`.
- `verify`: `{"op","vault","owner","receiver","amount_yocto","nonce","contacts","audio_wav_b64"}`.
- WAV: 16 kHz mono PCM16, at most 8 s, standard base64. The worker writes it
  again with a 44-byte header (the canonical WAV); the audio digest is the
  SHA-256 of the canonical WAV.

## Signed verdict

`verify` returns `verdict_json` (a string), `signature_b64` and `public_key`
(`ed25519:<base58>`). The signed message is
`SHA-256("seams:outlayer:voice-verdict:v1" || verdict_json bytes)`, signed by
the manifest key `verdict` (`bind: "project"`). The keystore derives that key
from the project and the caller; over HTTPS the caller is the payment-key
owner, so the vault's pinned key holds only for that payment-key owner.
`testdata/signed_verdict_v1.json` is the shared vector; the vault's tests and
`demo/test_demo.py` read it.

## Storage (the payment-key owner's cell)

- `template:v2:<vault>:<owner>`: keystore-encrypted,
  `SVT1 || epoch || ReDimNet SHA-256 || 192 f32 LE`. Replaced only by an
  authorized re-enrollment, which adds 1 to the epoch.
- `audio:v2:<digest>`: raw used-audio marker.

## Vendored crate

`vendor/bit-vec` is kept for `voice-probe`, which patches to it.
`legacy-onchain/` holds the tests of the earlier on-chain (yield) design.
