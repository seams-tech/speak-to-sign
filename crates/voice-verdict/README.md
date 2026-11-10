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

## The TDX quote of a call (optional)

`check_attestation_binding` is the Rust form of `checkAttestationBinding` of
the TypeScript package. It checks that the TDX quote of an OutLayer call
commits to the attestation record, that the record is for the output that
you hold, and that the WASM that ran is one that you accept.

```rust
use voice_verdict::{check_attestation_binding, parse_attestation_record, Binding};

// The record of GET <api>/attestations/by-call/<call_id>, and the output of the call.
let record = parse_attestation_record(&record_json)?;
let bound = check_attestation_binding(
    &record,
    &Binding::new(&output_json, &[MY_VERIFIER_WASM_SHA256])
        .input(&input_json) // optional: the compact JSON of the input, as you sent it
        .project("seams-v1.testnet/voice-verifier"),
)?;
// bound.measurements.view_args() are the arguments of
// `is_measurements_approved` on worker.outlayer.testnet.
```

- The output hash is over the compact JSON of the output with sorted keys.
  So the key order and the spaces of `output_json` do not matter.
- The input hash is over the compact JSON of the input in the order that you
  sent it. So pass the exact text, for example `JSON.stringify(input)`.
- It does not check the signature chain of the quote to Intel, or the
  approval of the measurements (`attestation::NOT_CHECKED`). The TypeScript
  package explains both.

## Test

```sh
cargo test
```

The tests read `../voice-verifier/testdata/signed_verdict_v2.json`,
`../spoken-intent/fixtures/spoken_intent_vectors_v1.json` and the two real
attestations in `../../packages/voice-verdict/tests/fixtures/`.
