#!/usr/bin/env bash
# Builds the release WASM of the merge-approvals contract and prints its size
# and SHA-256. The toolchain comes from rust-toolchain.toml (Rust 1.97.0).
# Output: res/merge_approvals.wasm
set -euo pipefail
cd "$(dirname "$0")"

# Extra flags from the shell would change the WASM and its hash.
unset RUSTFLAGS CARGO_ENCODED_RUSTFLAGS

cargo build -p merge-approvals --target wasm32-unknown-unknown --release --locked

mkdir -p res
cp target/wasm32-unknown-unknown/release/merge_approvals.wasm res/merge_approvals.wasm

wasm=res/merge_approvals.wasm
size=$(wc -c < "$wasm" | tr -d ' ')
sha=$(shasum -a 256 "$wasm" | cut -d ' ' -f 1)
echo "$wasm"
echo "size:    $size bytes"
echo "sha256:  $sha"
