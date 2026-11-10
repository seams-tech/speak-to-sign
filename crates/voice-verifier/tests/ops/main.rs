//! `enroll` and `verify` against a fake host: a fake speaker service that
//! signs as the real one does, a fake NEAR AI, storage maps and a real
//! ed25519 signing key. `fake.rs` holds the fake host and the shared input
//! builders; each other file tests one operation or one request kind.
mod enroll;
mod fake;
mod merges;
mod multisig;
mod notes;
mod verify;

use serde_json::json;

use fake::{call, Fake};

#[test]
fn unknown_op() {
    let out = call(&mut Fake::new(), json!({ "op": "audio_key" }));
    assert_eq!(out["reason"], "unsupported");
}
