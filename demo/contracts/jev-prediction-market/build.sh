#!/usr/bin/env bash
# Builds the release WASM of the pm-notes contract (and the fake OutLayer and
# fake USDC contracts for the sandbox test) and prints the contract's size and SHA-256.
# The toolchain comes from rust-toolchain.toml (Rust 1.97.0).
# Output: res/jev_prediction_market.wasm, res/fake_outlayer.wasm, res/fake_usdc.wasm
# This fast local build is for the sandbox tests. Its bytes depend on the
# computer. For a deploy, use ../reproducible.sh build jev-prediction-market: it gives the
# same bytes on any computer.
set -euo pipefail
cd "$(dirname "$0")"

# Extra flags from the shell would change the WASM and its hash.
unset RUSTFLAGS CARGO_ENCODED_RUSTFLAGS

cargo build -p jev-prediction-market -p fake-outlayer -p fake-usdc --target wasm32-unknown-unknown --release --locked

mkdir -p res
cp target/wasm32-unknown-unknown/release/jev_prediction_market.wasm res/jev_prediction_market.wasm
cp target/wasm32-unknown-unknown/release/fake_outlayer.wasm res/fake_outlayer.wasm
cp target/wasm32-unknown-unknown/release/fake_usdc.wasm res/fake_usdc.wasm

wasm=res/jev_prediction_market.wasm
size=$(wc -c < "$wasm" | tr -d ' ')
sha=$(shasum -a 256 "$wasm" | cut -d ' ' -f 1)
echo "$wasm"
echo "size:    $size bytes"
echo "sha256:  $sha"
