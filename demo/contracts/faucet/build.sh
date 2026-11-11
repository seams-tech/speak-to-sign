#!/usr/bin/env bash
# Builds the release WASM of the faucet contract and prints its size and SHA-256.
# The toolchain comes from rust-toolchain.toml. Output: res/speak_to_sign_faucet.wasm
# This is a fast local build. Its bytes depend on the computer. For a deploy, use ../reproducible.sh build faucet: it gives the
# same bytes on any computer.
set -euo pipefail
cd "$(dirname "$0")"

# Extra flags from the shell would change the WASM and its hash.
unset RUSTFLAGS CARGO_ENCODED_RUSTFLAGS

cargo build --target wasm32-unknown-unknown --release --locked

mkdir -p res
cp target/wasm32-unknown-unknown/release/speak_to_sign_faucet.wasm res/speak_to_sign_faucet.wasm

wasm=res/speak_to_sign_faucet.wasm
size=$(wc -c < "$wasm" | tr -d ' ')
sha=$(shasum -a 256 "$wasm" | cut -d ' ' -f 1)
echo "$wasm"
echo "size:    $size bytes"
echo "sha256:  $sha"
