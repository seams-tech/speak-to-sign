//! What the operations need from the worker. The WASM build implements it
//! with the OutLayer SDK and `wasi:http`; the tests use a fake.

/// One HTTPS POST.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PostRequest {
    /// `https://...`.
    pub url: String,
    /// Header name and value pairs.
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
    /// Connect, first-byte and between-bytes timeout, in seconds.
    pub timeout_secs: u64,
    /// A larger response body is an error.
    pub max_response_bytes: usize,
}

/// One result of [`Host::post_wait`]: (status, body) or an error, and the
/// time from the start of the batch to the end of the response body.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Timed {
    pub result: Result<(u16, Vec<u8>), String>,
    pub ms: u64,
}

/// The worker environment.
pub trait Host {
    /// A project secret (an OutLayer secret arrives as an environment
    /// variable).
    fn secret(&self, name: &str) -> Option<String>;
    /// Reads a keystore-encrypted record of the storage cell.
    fn storage_get(&mut self, key: &str) -> Result<Option<Vec<u8>>, String>;
    /// Writes a keystore-encrypted record if the key is absent. `true` if
    /// this call wrote it.
    fn storage_set_if_absent(&mut self, key: &str, value: &[u8]) -> Result<bool, String>;
    /// Replaces a keystore-encrypted record if it still holds `expected`.
    /// `true` if this call wrote it.
    fn storage_set_if_equals(&mut self, key: &str, expected: &[u8], value: &[u8]) -> Result<bool, String>;
    /// Reads a raw (not encrypted) record. No keystore round trip.
    fn marker_get(&mut self, key: &str) -> Result<Option<Vec<u8>>, String>;
    /// Writes a raw record if the key is absent. `true` if this call wrote it.
    fn marker_set_if_absent(&mut self, key: &str, value: &[u8]) -> Result<bool, String>;
    /// Starts every request at once and sends their bodies, then returns
    /// while the responses are still in flight. The storage calls are
    /// blocking host calls; the host runs the requests during them. One
    /// batch at a time: a new start drops a batch that nobody waited for.
    fn post_start(&mut self, requests: Vec<PostRequest>);
    /// Waits for every response of the started batch, in request order.
    /// Empty if no batch was started.
    fn post_wait(&mut self) -> Vec<Timed>;
    /// Drops the started batch without waiting (after a refusal).
    fn post_cancel(&mut self);
    /// 32 random bytes.
    fn random32(&mut self) -> Result<[u8; 32], String>;
    /// The wall clock, in ms since the UNIX epoch. It sets the verdict expiry.
    fn now_ms(&mut self) -> u64;
    /// ed25519 over `message` with the manifest signing key: the 64-byte
    /// signature.
    fn sign(&mut self, message: &[u8]) -> Result<Vec<u8>, String>;
    /// The 32-byte public key of the manifest signing key.
    fn public_key(&mut self) -> Result<Vec<u8>, String>;
}
