//! `seams-voice-verifier`: the Speak-to-Sign OutLayer worker. The Seams
//! verify route calls it through OutLayer's HTTPS API. Operations:
//!
//! - `enroll`: three recordings become the speaker template of one owner
//!   account. The owner authorizes them with a NEP-413 signature of a
//!   full-access key. The embeddings come from the speaker service (ReDimNet
//!   in a Phala CVM, signed embeddings with a pinned key).
//! - `verify`: the speaker (Phala) and the words (Whisper large-v3 on NEAR AI
//!   Cloud), called at the same time, against one typed request, then the
//!   policy step. The verdict is signed with the manifest signing key
//!   (`bind: "project"`), and the Wallet checks that signature against the
//!   key that it pins.
//!
//! The feature `local-speaker` gives a second variant of the worker: ReDimNet
//! runs inside the worker (`local_model`), and no request goes to Phala.
//!
//! The pure parts live here and build natively for tests. The binary adds
//! the OutLayer host in `wasm_host.rs` (storage, secrets, signing, the clock
//! and `wasi:http`).
#![forbid(unsafe_code)]

pub mod audio;
pub mod authorization;
pub mod config;
pub mod digest;
mod embedding;
pub mod envelope;
pub mod host;
pub mod input;
pub mod intent;
#[cfg(feature = "local-speaker")]
pub mod local_model;
pub mod model_cache;
pub mod nearai_attestation;
pub mod ohttp;
pub mod ops;
pub mod output;
pub mod policy;
pub mod speaker_client;
pub mod summary_check;
mod template;
mod transcriber;
mod words;

pub use ops::{run, run_with, Pins};
