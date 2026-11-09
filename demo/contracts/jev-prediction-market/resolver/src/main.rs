//! The OutLayer entry point: the input on stdin, one JSON object on stdout. The worker always
//! writes an object and exits with 0, also for an error (`{"error": "..."}`), so that the
//! contract can show the reason in its `resolution_failed` event.

#[cfg(target_arch = "wasm32")]
fn main() {
    use pm_notes_resolver::{MAX_INPUT_BYTES, run};
    use std::io::{Read, Write};

    let mut input = Vec::new();
    let output = match std::io::stdin().take(MAX_INPUT_BYTES as u64 + 1).read_to_end(&mut input) {
        Ok(_) => run(&input, &mut wasi::WasiHost),
        Err(_) => serde_json::json!({ "error": "cannot read the input" }),
    };
    let mut stdout = std::io::stdout();
    if stdout.write_all(output.to_string().as_bytes()).and_then(|()| stdout.flush()).is_err() {
        std::process::exit(1);
    }
}

#[cfg(target_arch = "wasm32")]
mod wasi {
    use pm_notes_resolver::{Host, MAX_RESPONSE_BYTES};
    use std::time::Duration;
    use wasi_http_client::{Client, Response};

    const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);

    /// OutLayer gives the secrets as environment variables. The manifest allows the hosts and
    /// sets their timeouts.
    pub struct WasiHost;

    impl Host for WasiHost {
        fn secret(&self, name: &str) -> Option<String> {
            std::env::var(name).ok()
        }

        fn post_json(&mut self, url: &str, token: &str, body: &[u8]) -> Result<(u16, Vec<u8>), String> {
            let authorization = format!("Bearer {token}");
            let response = Client::new()
                .post(url)
                .headers([
                    ("Authorization", authorization.as_str()),
                    ("Content-Type", "application/json"),
                    ("Accept", "application/json"),
                ])
                .connect_timeout(CONNECT_TIMEOUT)
                .body(body)
                .send()
                .map_err(|_| "no response".to_owned())?;
            let status = response.status();
            let body = read_body(response, MAX_RESPONSE_BYTES).map_err(|()| "the response is too long or broken".to_owned())?;
            Ok((status, body))
        }
    }

    fn read_body(response: Response, maximum: usize) -> Result<Vec<u8>, ()> {
        let mut body = Vec::new();
        loop {
            let remaining = maximum.saturating_sub(body.len());
            let request = remaining.saturating_add(1).min(16_384) as u64;
            let Some(chunk) = response.chunk(request).map_err(|_| ())? else {
                return Ok(body);
            };
            if chunk.is_empty() || chunk.len() > remaining {
                return Err(());
            }
            body.extend_from_slice(&chunk);
        }
    }
}

#[cfg(not(target_arch = "wasm32"))]
fn main() {
    eprintln!(
        "pm-notes-resolver runs on OutLayer: build it with ./build.sh (wasm32-wasip2). \
         `cargo test` runs the native tests with a fake host."
    );
    std::process::exit(2);
}
