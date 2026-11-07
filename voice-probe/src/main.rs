//! OutLayer entry point: read `input_data` from stdin, run `verify_latency`,
//! write one JSON value to stdout.

#[cfg(all(target_arch = "wasm32", not(feature = "speaker-service")))]
#[used]
#[link_section = "outlayer.manifest"]
static OUTLAYER_MANIFEST: [u8; include_bytes!("../manifest/outlayer.json").len()] =
    *include_bytes!("../manifest/outlayer.json");

#[cfg(all(target_arch = "wasm32", feature = "speaker-service"))]
#[used]
#[link_section = "outlayer.manifest"]
static OUTLAYER_MANIFEST: [u8; include_bytes!("../manifest/outlayer-speaker.json").len()] =
    *include_bytes!("../manifest/outlayer-speaker.json");

#[cfg(target_arch = "wasm32")]
fn main() {
    let input = outlayer::env::input();
    let mut host = wasm_host::WasmHost::default();
    let output = seams_voice_probe::run_json(&input, &mut host);
    outlayer::env::output(output.as_bytes());
}

#[cfg(not(target_arch = "wasm32"))]
fn main() {
    eprintln!("voice-probe runs only as a wasm32-wasip2 OutLayer worker");
    std::process::exit(2);
}

#[cfg(target_arch = "wasm32")]
mod wasm_host {
    use seams_voice_probe::{Host, PostRequest, SIGNING_KEY_PATH};
    use std::time::Duration;

    #[derive(Default)]
    pub struct WasmHost {
        #[cfg(all(feature = "redimnet", not(feature = "tiny")))]
        speaker: speaker::Speaker,
    }

    /// An HTTPS POST on `wasi:http`, as in the verifier: the body goes in
    /// 4096-byte writes, and the connect, first-byte and between-bytes
    /// timeouts are all `timeout_secs`.
    fn post(request: &PostRequest) -> Result<(u16, Vec<u8>), String> {
        use wasi::http::outgoing_handler;
        use wasi::http::types::{Fields, Method, OutgoingBody, OutgoingRequest, RequestOptions, Scheme};
        use wasi::io::streams::StreamError;

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
        let _ = options.set_connect_timeout(Some(timeout));
        let _ = options.set_first_byte_timeout(Some(timeout));
        let _ = options.set_between_bytes_timeout(Some(timeout));

        let future = outgoing_handler::handle(outgoing, Some(options)).map_err(|error| format!("{error:?}"))?;
        {
            let stream = body.write().map_err(|()| "body stream")?;
            for chunk in request.body.chunks(4096) {
                stream.blocking_write_and_flush(chunk).map_err(|error| format!("write: {error:?}"))?;
            }
        }
        OutgoingBody::finish(body, None).map_err(|error| format!("finish: {error:?}"))?;

        let response = loop {
            match future.get() {
                Some(result) => break result,
                None => future.subscribe().block(),
            }
        };
        let response = response.map_err(|()| "response taken")?.map_err(|error| format!("{error:?}"))?;
        drop(future);
        let status = response.status();
        let incoming = response.consume().map_err(|()| "consume")?;
        let mut out = Vec::new();
        {
            let stream = incoming.stream().map_err(|()| "response stream")?;
            loop {
                match stream.blocking_read(65_536) {
                    Ok(chunk) => {
                        out.extend_from_slice(&chunk);
                        if out.len() > request.max_response_bytes {
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

    /// Several HTTPS POSTs in flight at once on `wasi:http` (0.2).
    ///
    /// `outgoing_handler::handle` starts each request and returns a future at
    /// once, so the host connects to every host in parallel. The bodies go
    /// out with non-blocking writes (`check_write`, then `write` of at most
    /// that many bytes) on every stream in turn. When no stream can take
    /// bytes and no response is ready, one `poll` call waits on every stream
    /// and response pollable together. A response body is read as soon as its
    /// future is ready; its time is from the batch start to the end of that
    /// body.
    #[cfg(feature = "speaker-service")]
    mod concurrent {
        use seams_voice_probe::{PostRequest, Timed};
        use std::time::{Duration, Instant};
        use wasi::http::outgoing_handler::{self, FutureIncomingResponse};
        use wasi::http::types::{
            Fields, IncomingResponse, Method, OutgoingBody, OutgoingRequest, RequestOptions, Scheme,
        };
        use wasi::io::streams::{OutputStream, StreamError};

        struct Flight<'a> {
            request: &'a PostRequest,
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

        impl Flight<'_> {
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

        pub fn post_all(requests: &[PostRequest]) -> Vec<Timed> {
            let started = Instant::now();
            let mut flights: Vec<Flight> = requests
                .iter()
                .map(|request| {
                    let mut flight =
                        Flight { request, future: None, stream: None, body: None, sent: 0, done: None, ms: 0 };
                    match start(request) {
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
            loop {
                let mut full = vec![false; flights.len()];
                for (index, flight) in flights.iter_mut().enumerate() {
                    if flight.done.is_none() {
                        full[index] = flight.push(started);
                        flight.collect(started);
                    }
                }
                if flights.iter().all(|flight| flight.done.is_some()) {
                    break;
                }
                // Wait for any stream with room or any response.
                let pollables: Vec<_> = flights
                    .iter()
                    .enumerate()
                    .filter(|(_, flight)| flight.done.is_none())
                    .flat_map(|(index, flight)| {
                        let stream = flight.stream.as_ref().filter(|_| full[index]).map(OutputStream::subscribe);
                        let future = flight.future.as_ref().map(FutureIncomingResponse::subscribe);
                        stream.into_iter().chain(future)
                    })
                    .collect();
                let refs: Vec<_> = pollables.iter().collect();
                wasi::io::poll::poll(&refs);
            }
            flights
                .into_iter()
                .map(|flight| Timed { result: flight.done.expect("every flight is done"), ms: flight.ms })
                .collect()
        }
    }

    #[cfg(all(feature = "redimnet", not(feature = "tiny")))]
    mod speaker {
        use seams_voice_probe::{EMBEDDING_DIM, REDIMNET_SHA256, REDIMNET_URL};
        use sha2::{Digest, Sha256};
        use std::time::Duration;
        use tract_onnx::prelude::*;

        type Plan = std::sync::Arc<TypedRunnableModel>;

        #[derive(Default)]
        pub struct Speaker {
            bytes: Option<Vec<u8>>,
            plan: Option<Plan>,
        }

        impl Speaker {
            pub fn fetch(&mut self) -> Result<usize, String> {
                let response = wasi_http_client::Client::new()
                    .get(REDIMNET_URL)
                    .connect_timeout(Duration::from_secs(10))
                    .send()
                    .map_err(|error| error.to_string())?;
                if response.status() != 200 {
                    return Err(format!("status {}", response.status()));
                }
                let bytes = response.body().map_err(|error| error.to_string())?;
                let actual: String = Sha256::digest(&bytes).iter().map(|byte| format!("{byte:02x}")).collect();
                if actual != REDIMNET_SHA256 {
                    return Err(format!("digest {actual} is not pinned"));
                }
                let len = bytes.len();
                self.bytes = Some(bytes);
                Ok(len)
            }

            /// ReDimNet fails tract's declutter pass, so it runs the typed plan.
            pub fn load(&mut self, samples: usize) -> Result<(), String> {
                let bytes = self.bytes.take().ok_or("not fetched")?;
                let plan = (|| -> TractResult<Plan> {
                    tract_onnx::onnx()
                        .model_for_read(&mut &bytes[..])?
                        .with_input_fact(0, f32::fact([1, samples]).into())?
                        .into_typed()?
                        .into_runnable()
                })()
                .map_err(|error| format!("{error:#}"))?;
                self.plan = Some(plan);
                Ok(())
            }

            pub fn run(&mut self, samples: &[f32]) -> Result<usize, String> {
                let plan = self.plan.as_ref().ok_or("not loaded")?;
                let outputs = (|| -> TractResult<TVec<TValue>> {
                    let input = tract_ndarray::Array2::from_shape_vec((1, samples.len()), samples.to_vec())?;
                    plan.run(tvec!(Tensor::from(input).into()))
                })()
                .map_err(|error| format!("{error:#}"))?;
                outputs
                    .iter()
                    .map(|output| output.len())
                    .find(|len| *len == EMBEDDING_DIM)
                    .ok_or_else(|| "no 192-value output".to_string())
            }
        }
    }

    impl Host for WasmHost {
        fn env(&self, name: &str) -> Option<String> {
            std::env::var(name).ok()
        }

        fn post(&mut self, request: &PostRequest) -> Result<(u16, Vec<u8>), String> {
            post(request)
        }

        #[cfg(feature = "speaker-service")]
        fn post_concurrent(&mut self, requests: &[PostRequest]) -> Vec<seams_voice_probe::Timed> {
            concurrent::post_all(requests)
        }

        #[cfg(feature = "speaker-service")]
        fn nonce(&mut self) -> Result<[u8; 32], String> {
            wasi::random::random::get_random_bytes(32).try_into().map_err(|_| "random".to_string())
        }

        #[cfg(all(feature = "redimnet", not(feature = "tiny")))]
        fn redimnet_fetch(&mut self) -> Result<usize, String> {
            self.speaker.fetch()
        }

        #[cfg(all(feature = "redimnet", not(feature = "tiny")))]
        fn redimnet_load(&mut self, samples: usize) -> Result<(), String> {
            self.speaker.load(samples)
        }

        #[cfg(all(feature = "redimnet", not(feature = "tiny")))]
        fn redimnet_run(&mut self, samples: &[f32]) -> Result<usize, String> {
            self.speaker.run(samples)
        }

        #[cfg(not(all(feature = "redimnet", not(feature = "tiny"))))]
        fn redimnet_fetch(&mut self) -> Result<usize, String> {
            Err("not in this build".into())
        }

        #[cfg(not(all(feature = "redimnet", not(feature = "tiny"))))]
        fn redimnet_load(&mut self, _samples: usize) -> Result<(), String> {
            Err("not in this build".into())
        }

        #[cfg(not(all(feature = "redimnet", not(feature = "tiny"))))]
        fn redimnet_run(&mut self, _samples: &[f32]) -> Result<usize, String> {
            Err("not in this build".into())
        }

        fn sign(&mut self, message: &[u8]) -> Result<(Vec<u8>, Vec<u8>), String> {
            use outlayer::signing_keys;
            let signature = signing_keys::sign(SIGNING_KEY_PATH, None, message).map_err(|error| error.0)?;
            let public_key = signing_keys::public_key(SIGNING_KEY_PATH, None).map_err(|error| error.0)?;
            Ok((signature, public_key))
        }
    }
}
