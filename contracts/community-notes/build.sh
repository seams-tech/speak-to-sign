#!/usr/bin/env bash
# Builds the release WASM of the community-notes contract and prints its size
# and SHA-256. The toolchain comes from rust-toolchain.toml (Rust 1.97.0).
# Output: res/community_notes.wasm
set -euo pipefail
cd "$(dirname "$0")"

# Extra flags from the shell would change the WASM and its hash.
unset RUSTFLAGS CARGO_ENCODED_RUSTFLAGS

cargo build -p community-notes --target wasm32-unknown-unknown --release --locked

mkdir -p res
cp target/wasm32-unknown-unknown/release/community_notes.wasm res/community_notes.wasm

wasm=res/community_notes.wasm
size=$(wc -c < "$wasm" | tr -d ' ')
sha=$(shasum -a 256 "$wasm" | cut -d ' ' -f 1)
echo "$wasm"
echo "size:    $size bytes"
echo "sha256:  $sha"
