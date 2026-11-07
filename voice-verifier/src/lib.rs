//! `seams-voice-verifier`: the OutLayer worker of Refactor 210, HTTPS path
//! (plan Sections 7.5 and 11.5). The Wallet calls it through OutLayer's
//! HTTPS API. Operations:
//!
//! - `enroll`: three recordings become the speaker template of one vault
//!   owner. The embeddings come from the speaker service (ReDimNet in a Phala
//!   CVM, signed embeddings with a pinned key).
//! - `verify`: the speaker (Phala) and the words (Whisper large-v3 on NEAR AI
//!   Cloud), called at the same time, against one transfer request. The
//!   verdict is signed with the manifest signing key (`bind: "project"`), and
//!   the vault checks that signature against its pinned key.
//!
//! The pure parts live here and build natively for tests. `main.rs` adds the
//! OutLayer host (storage, secrets, signing and `wasi:http`).
#![forbid(unsafe_code)]

pub mod audio;
pub mod config;
pub mod digest;
pub mod enrollment;
pub mod host;
pub mod input;
pub mod ops;
pub mod output;
pub mod speaker;
pub mod transcriber;
pub mod words;

pub use ops::{run, run_with, Pins};
