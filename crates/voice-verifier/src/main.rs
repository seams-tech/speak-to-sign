//! OutLayer entry point: read the input from stdin, run one operation,
//! write one JSON value to stdout.

#[cfg(target_arch = "wasm32")]
#[used]
#[link_section = "outlayer.manifest"]
static OUTLAYER_MANIFEST: [u8; include_bytes!("../manifest/outlayer.json").len()] =
    *include_bytes!("../manifest/outlayer.json");

#[cfg(target_arch = "wasm32")]
fn main() {
    let input = outlayer::env::input();
    let mut host = wasm_host::WasmHost::default();
    let output = seams_voice_verifier::run(&input, &mut host);
    outlayer::env::output(&output);
}

#[cfg(not(target_arch = "wasm32"))]
fn main() {
    eprintln!("seams-voice-verifier runs only as a wasm32-wasip2 OutLayer worker");
    std::process::exit(2);
}

#[cfg(target_arch = "wasm32")]
mod wasm_host {
    use outlayer::{signing_keys, storage};
    use seams_voice_verifier::config::SIGNING_KEY_PATH;
    use seams_voice_verifier::host::{Host, PostRequest, Timed};

    #[derive(Default)]
    pub struct WasmHost {
        batch: Option<concurrent::Batch>,
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
            self.batch = None;
            self.batch = Some(concurrent::Batch::start(requests));
        }

        fn post_poll(&mut self) {
            if let Some(batch) = &mut self.batch {
                batch.poll();
            }
        }

        fn post_wait(&mut self) -> Vec<Timed> {
            self.batch.take().map(concurrent::Batch::wait).unwrap_or_default()
        }

        fn post_cancel(&mut self) {
            self.batch = None;
        }

        fn random32(&mut self) -> Result<[u8; 32], String> {
            wasi::random::random::get_random_bytes(32).try_into().map_err(|_| "random".to_string())
        }

        fn now_ms(&mut self) -> u64 {
            // A clock before 1970 gives 0, so the verdict is already expired.
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map_or(0, |since| since.as_millis() as u64)
        }

        fn sign(&mut self, message: &[u8]) -> Result<Vec<u8>, String> {
            signing_keys::sign(SIGNING_KEY_PATH, None, message).map_err(|error| error.0)
        }

        fn public_key(&mut self) -> Result<Vec<u8>, String> {
            signing_keys::public_key(SIGNING_KEY_PATH, None).map_err(|error| error.0)
        }
    }

    /// Several HTTPS POSTs in flight at once on `wasi:http` (0.2), as in the
    /// latency probe (measured on OutLayer testnet).
    ///
    /// `outgoing_handler::handle` starts each request and returns a future at
    /// once, so the host connects to every host in parallel. The bodies go
    /// out with non-blocking writes (`check_write`, then `write` of at most
    /// that many bytes) on every stream in turn. When no stream can take
    /// bytes and no response is ready, one `poll` call waits on every stream
    /// and response pollable together. A response body is read as soon as its
    /// future is ready; its time is from the batch start to the end of that
    /// body.
    ///
    /// [`Batch::start`] returns when every body is sent (or a request has
    /// failed or answered). The host then carries the requests while the
    /// worker makes its blocking storage calls. [`Batch::wait`] polls the
    /// responses. A dropped batch drops its futures and streams.
    mod concurrent {
        use seams_voice_verifier::host::{PostRequest, Timed};
        use std::time::{Duration, Instant};
        use wasi::http::outgoing_handler::{self, FutureIncomingResponse};
        use wasi::http::types::{Fields, IncomingResponse, Method, OutgoingBody, OutgoingRequest, RequestOptions, Scheme};
        use wasi::io::streams::{OutputStream, StreamError};

        struct Flight {
            request: PostRequest,
            future: Option<FutureIncomingResponse>,
            // Drop order: the stream (a child of the body) before the body.
            stream: Option<OutputStream>,
            body: Option<OutgoingBody>,
            sent: usize,
            done: Option<Result<(u16, Vec<u8>), String>>,
            ms: u64,
        }

        fn start(request: &PostRequest) -> Result<(FutureIncomingResponse, OutgoingBody, OutputStream), String> {
            let rest = request.url.strip_prefix("https://").ok_or("not an https URL")?;
            let (authority, path) = match rest.find('/') {
                Some(index) => rest.split_at(index),
                None => (rest, "/"),
            };
            let entries: Vec<(String, Vec<u8>)> =
                request.headers.iter().map(|(name, value)| (name.clone(), value.as_bytes().to_vec())).collect();
            let headers = Fields::from_list(&entries).map_err(|error| format!("headers: {error:?}"))?;
            let outgoing = OutgoingRequest::new(headers);
            outgoing.set_method(&Method::Post).map_err(|()| "method")?;
            outgoing.set_scheme(Some(&Scheme::Https)).map_err(|()| "scheme")?;
            outgoing.set_authority(Some(authority)).map_err(|()| "authority")?;
            outgoing.set_path_with_query(Some(path)).map_err(|()| "path")?;
            let body = outgoing.body().map_err(|()| "body")?;
            let timeout = Duration::from_secs(request.timeout_secs).as_nanos() as u64;
            let options = RequestOptions::new();
            // A runtime that does not support one of these keeps its own limit.
            let _ = options.set_connect_timeout(Some(timeout));
            let _ = options.set_first_byte_timeout(Some(timeout));
            let _ = options.set_between_bytes_timeout(Some(timeout));
            let future = outgoing_handler::handle(outgoing, Some(options)).map_err(|error| format!("{error:?}"))?;
            let stream = body.write().map_err(|()| "body stream")?;
            Ok((future, body, stream))
        }

        fn read(response: IncomingResponse, max: usize) -> Result<(u16, Vec<u8>), String> {
            let status = response.status();
            let incoming = response.consume().map_err(|()| "consume")?;
            let mut out = Vec::new();
            {
                let stream = incoming.stream().map_err(|()| "response stream")?;
                loop {
                    match stream.blocking_read(65_536) {
                        Ok(chunk) => {
                            out.extend_from_slice(&chunk);
                            if out.len() > max {
                                return Err("response too large".into());
                            }
                        }
                        Err(StreamError::Closed) => break,
                        Err(error) => return Err(format!("read: {error:?}")),
                    }
                }
            }
            drop(incoming);
            Ok((status, out))
        }

        impl Flight {
            fn fail(&mut self, error: String, started: Instant) {
                self.stream = None;
                self.body = None;
                self.done = Some(Err(error));
                self.ms = started.elapsed().as_millis() as u64;
            }

            /// Writes what the stream takes now. Returns true if the stream
            /// is still open and full (so it needs a poll).
            fn push(&mut self, started: Instant) -> bool {
                let Some(stream) = &self.stream else { return false };
                let data = &self.request.body;
                while self.sent < data.len() {
                    match stream.check_write() {
                        Ok(0) => return true,
                        Ok(room) => {
                            let end = data.len().min(self.sent + room as usize);
                            if let Err(error) = stream.write(&data[self.sent..end]) {
                                self.fail(format!("write: {error:?}"), started);
                                return false;
                            }
                            self.sent = end;
                        }
                        Err(error) => {
                            self.fail(format!("write: {error:?}"), started);
                            return false;
                        }
                    }
                }
                // All bytes are queued: flush, then finish the body.
                if let Err(error) = stream.blocking_flush() {
                    self.fail(format!("flush: {error:?}"), started);
                    return false;
                }
                self.stream = None;
                if let Some(body) = self.body.take() {
                    if let Err(error) = OutgoingBody::finish(body, None) {
                        self.fail(format!("finish: {error:?}"), started);
                    }
                }
                false
            }

            /// Takes the response if it is ready.
            fn collect(&mut self, started: Instant) {
                let Some(future) = &self.future else { return };
                let Some(result) = future.get() else { return };
                self.future = None;
                let result = match result {
                    Ok(Ok(response)) => read(response, self.request.max_response_bytes),
                    Ok(Err(error)) => Err(format!("{error:?}")),
                    Err(()) => Err("response taken".into()),
                };
                // A reply can come before the whole body is sent.
                self.stream = None;
                self.body = None;
                self.done = Some(result);
                self.ms = started.elapsed().as_millis() as u64;
            }
        }

        /// Requests in flight, from one start time.
        pub struct Batch {
            started: Instant,
            flights: Vec<Flight>,
        }

        impl Batch {
            /// Starts every request and sends every body.
            pub fn start(requests: Vec<PostRequest>) -> Self {
                let started = Instant::now();
                let flights = requests
                    .into_iter()
                    .map(|request| {
                        let mut flight =
                            Flight { request, future: None, stream: None, body: None, sent: 0, done: None, ms: 0 };
                        match start(&flight.request) {
                            Ok((future, body, stream)) => {
                                flight.future = Some(future);
                                flight.body = Some(body);
                                flight.stream = Some(stream);
                            }
                            Err(error) => flight.fail(error, started),
                        }
                        flight
                    })
                    .collect();
                let mut batch = Self { started, flights };
                batch.drive(true);
                batch
            }

            /// Pushes bodies and takes the responses that are ready, once,
            /// without waiting.
            pub fn poll(&mut self) {
                let started = self.started;
                for flight in self.flights.iter_mut().filter(|flight| flight.done.is_none()) {
                    flight.push(started);
                    flight.collect(started);
                }
            }

            /// Waits for every response.
            pub fn wait(mut self) -> Vec<Timed> {
                self.drive(false);
                self.flights
                    .into_iter()
                    .map(|flight| Timed { result: flight.done.expect("every flight is done"), ms: flight.ms })
                    .collect()
            }

            /// Pushes bodies and takes responses until every body is sent
            /// (`until_sent`) or every response is in.
            fn drive(&mut self, until_sent: bool) {
                let started = self.started;
                loop {
                    let mut full = vec![false; self.flights.len()];
                    for (index, flight) in self.flights.iter_mut().enumerate() {
                        if flight.done.is_none() {
                            full[index] = flight.push(started);
                            flight.collect(started);
                        }
                    }
                    let open = |flight: &Flight| flight.done.is_none();
                    if !self.flights.iter().any(open) {
                        return;
                    }
                    if until_sent && !self.flights.iter().any(|flight| open(flight) && flight.stream.is_some()) {
                        return;
                    }
                    // Wait for any stream with room or any response.
                    let pollables: Vec<_> = self
                        .flights
                        .iter()
                        .enumerate()
                        .filter(|(_, flight)| open(flight))
                        .flat_map(|(index, flight)| {
                            let stream = flight.stream.as_ref().filter(|_| full[index]).map(OutputStream::subscribe);
                            let future = flight.future.as_ref().map(FutureIncomingResponse::subscribe);
                            stream.into_iter().chain(future)
                        })
                        .collect();
                    let refs: Vec<_> = pollables.iter().collect();
                    wasi::io::poll::poll(&refs);
                }
            }
        }
    }
}
