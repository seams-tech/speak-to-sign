# seams-voice-verdict

Checks a signed Speak-to-Sign voice verdict
(`seams_voice_signed_verdict_v2`) in Rust. It is `no_std` with `alloc`. It
does not depend on `spoken-intent`, on the verifier or on a chain.

The same check in TypeScript, with the full list of the checks and the rules
for the caller, is in [`packages/voice-verdict`](../../packages/voice-verdict).

## On a server

```rust
use voice_verdict::{check_verdict, parse_ed25519_key, request_digest, Check, Refusal};

fn confirmed(verdict_json: &str, signature_b64: &str, request_borsh: &[u8], now_ms: u64) -> bool {
    // The verifier key that you pin. This one is the test key of the shared vectors.
    let key = parse_ed25519_key("ed25519:2iXtA8oeZqUU5pofxK971TCEvFGfems2AcDRaZHKD2pQ").unwrap();
    let Some(digest) = request_digest(request_borsh) else { return false };
    match check_verdict(verdict_json, signature_b64, &key, &Check::at(now_ms).request(&digest)) {
        Ok(_verdict) => true,
        Err(Refusal::StepUp(_)) => false, // Ask for a second approval.
        Err(_) => false,
    }
}
```

## In a NEAR contract

Turn the default feature off, and pass the ed25519 check of the host:

```toml
seams-voice-verdict = { path = "../../crates/voice-verdict", default-features = false }
```

```rust
let verdict = voice_verdict::check_verdict_with(
    &verdict_json,
    &signature_b64,
    &self.verifier_key,
    &Check::at(env::block_timestamp_ms()).request(&my_digest),
    |signature, message, key| env::ed25519_verify(signature, message, key),
);
```

A contract needs:

- the 32-byte verifier key in its state, and a guarded method to change it;
- the request digest, computed from its own state and the caller, not from
  an argument;
- its own guard against a second use of one verdict, if the action is not
  idempotent. A verdict has no nonce and passes again until it expires.

## Other functions

- `confirmation_borsh(owner, context, payload_sha256, summary)`: the Borsh
  bytes of a request for an application owner (`app:<id>`). Pass them to
  `request_digest`.
- `check_transcript(...)`: the check of a signed transcript of the operation
  `transcribe`. A transcript approves no request.

The check of the TDX quote of a call is only in the TypeScript package.

## Test

```sh
cargo test
```

The tests read `../voice-verifier/testdata/signed_verdict_v2.json` and
`../spoken-intent/fixtures/spoken_intent_vectors_v1.json`.
