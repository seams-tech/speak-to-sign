//! `enroll` and `verify` against a fake host: a fake speaker service that
//! signs as the real one does, a fake NEAR AI (its gateway opens the sealed
//! Whisper request), storage maps and a real
//! ed25519 signing key. `fake.rs` holds the fake host and the shared input
//! builders; each other file tests one operation or one request kind.
mod bets;
mod detect;
mod enroll;
mod fake;
mod local_speaker;
mod merges;
mod multisig;
mod notes;
mod providers;
mod sealed;
mod transcribe;
mod verify;
mod web2;
// The gateway check of the NEAR AI path. The `venice` build has none.
#[cfg(not(feature = "venice"))]
mod whisper;

use serde_json::json;

use fake::{call, Fake};

#[test]
fn unknown_op() {
    let out = call(&mut Fake::new(), json!({ "op": "forget" }));
    assert_eq!(out["reason"], "unsupported");
}
