//! OutLayer entry point: read the input from stdin, run one operation,
//! write one JSON value to stdout.

#[cfg(target_arch = "wasm32")]
mod wasm_host;

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
