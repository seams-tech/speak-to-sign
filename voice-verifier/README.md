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
- `verify` sends both requests at once (`wasi:http`, one poll loop).

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
  `SVT1 || epoch || ReDimNet SHA-256 || 192 f32 LE`. Written once.
- `audio:v2:<digest>`: raw used-audio marker.

## Vendored crate

`vendor/bit-vec` is kept for `voice-probe`, which patches to it.
`legacy-onchain/` holds the tests of the earlier on-chain (yield) design.
