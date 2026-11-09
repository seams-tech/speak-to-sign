//! The OutLayer host of the WASM build: storage, secrets, signing and the
//! clock come from the OutLayer SDK, and the HTTPS requests go out on
//! `wasi:http` (see `http_batch`).
mod http_batch;

use outlayer::{signing_keys, storage};
use seams_voice_verifier::config::SIGNING_KEY_PATH;
use seams_voice_verifier::host::{Host, PostRequest, Timed};

#[derive(Default)]
pub struct WasmHost {
    batch: Option<http_batch::Batch>,
}

impl Host for WasmHost {
    fn secret(&self, name: &str) -> Option<String> {
        std::env::var(name).ok()
    }

    fn storage_get(&mut self, key: &str) -> Result<Option<Vec<u8>>, String> {
        storage::get(key).map_err(|error| error.to_string())
    }

    fn storage_set_if_absent(&mut self, key: &str, value: &[u8]) -> Result<bool, String> {
        storage::set_if_absent(key, value).map_err(|error| error.to_string())
    }

    fn storage_set_if_equals(&mut self, key: &str, expected: &[u8], value: &[u8]) -> Result<bool, String> {
        storage::set_if_equals(key, expected, value).map(|(written, _)| written).map_err(|error| error.to_string())
    }

    fn marker_get(&mut self, key: &str) -> Result<Option<Vec<u8>>, String> {
        storage::get_raw(key).map_err(|error| error.to_string())
    }

    fn marker_set_if_absent(&mut self, key: &str, value: &[u8]) -> Result<bool, String> {
        storage::set_if_absent_raw(key, value).map_err(|error| error.to_string())
    }

    fn post_start(&mut self, requests: Vec<PostRequest>) {
        // Drop a batch that nobody waited for before the new requests start,
        // so that its streams and responses close first.
        self.batch = None;
        self.batch = Some(http_batch::Batch::start(requests));
    }

    fn post_poll(&mut self) {
        if let Some(batch) = &mut self.batch {
            batch.poll();
        }
    }

    fn post_wait(&mut self) -> Vec<Timed> {
        self.batch.take().map(http_batch::Batch::wait).unwrap_or_default()
    }

    fn post_cancel(&mut self) {
        self.batch = None;
    }

    fn random32(&mut self) -> Result<[u8; 32], String> {
        wasi::random::random::get_random_bytes(32).try_into().map_err(|_| "random".to_string())
    }

    fn now_ms(&mut self) -> u64 {
        // A clock before 1970 gives 0, so the verdict is already expired.
        std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |since| since.as_millis() as u64)
    }

    fn sign(&mut self, message: &[u8]) -> Result<Vec<u8>, String> {
        signing_keys::sign(SIGNING_KEY_PATH, None, message).map_err(|error| error.0)
    }

    fn public_key(&mut self) -> Result<Vec<u8>, String> {
        signing_keys::public_key(SIGNING_KEY_PATH, None).map_err(|error| error.0)
    }
}
