//! OutLayer entry point: read the input from stdin, run one operation,
//! write one JSON value to stdout.

#[cfg(target_arch = "wasm32")]
mod wasm_host;

#[cfg(all(feature = "local-speaker", feature = "venice"))]
compile_error!("build `local-speaker` or `venice`, not both");

#[cfg(all(target_arch = "wasm32", not(feature = "local-speaker"), not(feature = "venice")))]
#[used]
#[link_section = "outlayer.manifest"]
static OUTLAYER_MANIFEST: [u8; include_bytes!("../manifest/outlayer.json").len()] =
    *include_bytes!("../manifest/outlayer.json");

// The `venice` variant: the Venice AI host in place of the two Intel hosts.
#[cfg(all(target_arch = "wasm32", feature = "venice"))]
#[used]
#[link_section = "outlayer.manifest"]
static OUTLAYER_MANIFEST: [u8; include_bytes!("../manifest/outlayer-venice.json").len()] =
    *include_bytes!("../manifest/outlayer-venice.json");

// The `local-speaker` variant: the model host in place of the speaker service.
#[cfg(all(target_arch = "wasm32", feature = "local-speaker"))]
#[used]
#[link_section = "outlayer.manifest"]
static OUTLAYER_MANIFEST: [u8; include_bytes!("../manifest/outlayer-local-speaker.json").len()] =
    *include_bytes!("../manifest/outlayer-local-speaker.json");

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
