#!/bin/sh
# Builds the OutLayer worker of the pm-notes market and prints its size and
# SHA-256. The toolchain comes from rust-toolchain.toml (Rust 1.97.1 with
# wasm32-wasip2). The SHA-256 is the OutLayer version key.
set -eu
cd "$(dirname "$0")"
unset RUSTFLAGS CARGO_ENCODED_RUSTFLAGS
cargo build --release --target wasm32-wasip2 --locked
WASM=${CARGO_TARGET_DIR:-target}/wasm32-wasip2/release/pm-notes-resolver.wasm
mkdir -p res
cp "$WASM" res/pm-notes-resolver.wasm
BYTES=$(wc -c < res/pm-notes-resolver.wasm | tr -d ' ')
echo "res/pm-notes-resolver.wasm"
echo "size:    $BYTES bytes"
echo "sha256:  $(shasum -a 256 res/pm-notes-resolver.wasm | cut -d' ' -f1)"
