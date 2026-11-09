//! Several HTTPS POSTs in flight at once on `wasi:http` (0.2), as in the
//! latency probe (measured on OutLayer testnet).
//!
//! `outgoing_handler::handle` starts each request and returns a future at
//! once, so the host connects to every host in parallel. The bodies go
//! out with non-blocking writes (`check_write`, then `write` of at most
//! that many bytes) on every stream in turn. When no stream can take
//! bytes and no response is ready, one `poll` call waits on every stream
//! and response pollable together. A response body is read as soon as its
//! future is ready; its time is from the batch start to the end of that
//! body.
//!
//! [`Batch::start`] returns when every body is sent (or a request has
//! failed or answered). The host then carries the requests while the
//! worker makes its blocking storage calls. [`Batch::wait`] polls the
//! responses. A dropped batch drops its futures and streams.
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
    /// The stream is open and took no more bytes at the last push, so the
    /// next wait includes it.
    full: bool,
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
    /// Ends the flight with `result` and its time. A reply can come before
    /// the whole body is sent, so the stream and the body go too.
    fn finish_with(&mut self, result: Result<(u16, Vec<u8>), String>, started: Instant) {
        self.stream = None;
        self.body = None;
        self.done = Some(result);
        self.ms = started.elapsed().as_millis() as u64;
    }

    fn fail(&mut self, error: String, started: Instant) {
        self.finish_with(Err(error), started);
    }

    /// Writes what the stream takes now. Sets `full` if the stream is still
    /// open and takes no more bytes now (so it needs a poll).
    fn push(&mut self, started: Instant) {
        self.full = false;
        let Some(stream) = &self.stream else { return };
        let data = &self.request.body;
        while self.sent < data.len() {
            match stream.check_write() {
                Ok(0) => {
                    self.full = true;
                    return;
                }
                Ok(room) => {
                    let end = data.len().min(self.sent + room as usize);
                    if let Err(error) = stream.write(&data[self.sent..end]) {
                        self.fail(format!("write: {error:?}"), started);
                        return;
                    }
                    self.sent = end;
                }
                Err(error) => {
                    self.fail(format!("write: {error:?}"), started);
                    return;
                }
            }
        }
        // All bytes are queued: flush, then finish the body.
        if let Err(error) = stream.blocking_flush() {
            self.fail(format!("flush: {error:?}"), started);
            return;
        }
        self.stream = None;
        if let Some(body) = self.body.take() {
            if let Err(error) = OutgoingBody::finish(body, None) {
                self.fail(format!("finish: {error:?}"), started);
            }
        }
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
        self.finish_with(result, started);
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
                    Flight { request, future: None, stream: None, body: None, sent: 0, full: false, done: None, ms: 0 };
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
        loop {
            self.poll();
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
                .filter(|flight| open(flight))
                .flat_map(|flight| {
                    let stream = flight.stream.as_ref().filter(|_| flight.full).map(OutputStream::subscribe);
                    let future = flight.future.as_ref().map(FutureIncomingResponse::subscribe);
                    stream.into_iter().chain(future)
                })
                .collect();
            let refs: Vec<_> = pollables.iter().collect();
            wasi::io::poll::poll(&refs);
        }
    }
}
