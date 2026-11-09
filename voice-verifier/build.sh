#!/bin/sh
# Builds the OutLayer worker and prints its size and SHA-256.
# The HTTPS design needs a small worker (Gate 0: the 8 MB tract worker cost
# 8-13 s of fixed time), so this fails at 1,000,000 bytes or more.
set -eu
cd "$(dirname "$0")"
cargo build --release --target wasm32-wasip2 --locked \
  --config 'target.wasm32-wasip2.rustflags=["-C","target-feature=+simd128"]'
WASM=${CARGO_TARGET_DIR:-target}/wasm32-wasip2/release/seams-voice-verifier.wasm
BYTES=$(wc -c < "$WASM" | tr -d ' ')
echo "$WASM"
echo "bytes  $BYTES"
echo "sha256 $(shasum -a 256 "$WASM" | cut -d' ' -f1)"
if [ "$BYTES" -ge 1000000 ]; then
  echo "error: the WASM is at or above 1,000,000 bytes" >&2
  exit 1
fi
