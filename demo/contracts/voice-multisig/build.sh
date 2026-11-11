#!/usr/bin/env bash
# Builds the release WASM of the voice-multisig contract and prints its size
# and SHA-256. The toolchain comes from rust-toolchain.toml (Rust 1.97.0).
# Output: res/voice_multisig.wasm
# This fast local build is for the sandbox tests. Its bytes depend on the
# computer. For a deploy, use ../reproducible.sh build voice-multisig: it gives the
# same bytes on any computer.
set -euo pipefail
cd "$(dirname "$0")"

# Extra flags from the shell would change the WASM and its hash.
unset RUSTFLAGS CARGO_ENCODED_RUSTFLAGS

cargo build -p voice-multisig --target wasm32-unknown-unknown --release --locked

mkdir -p res
cp target/wasm32-unknown-unknown/release/voice_multisig.wasm res/voice_multisig.wasm

wasm=res/voice_multisig.wasm
size=$(wc -c < "$wasm" | tr -d ' ')
sha=$(shasum -a 256 "$wasm" | cut -d ' ' -f 1)
echo "$wasm"
echo "size:    $size bytes"
echo "sha256:  $sha"
