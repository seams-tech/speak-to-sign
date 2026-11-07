#!/bin/sh
# Builds the three latency probe workers and prints each size and SHA-256.
#   full:    ReDimNet in tract, NEAR AI Whisper, word check, signature
#   tiny:    NEAR AI Whisper, word check, signature (no tract in the graph)
#   speaker: tiny, plus the speaker service embedding (task F), with both
#            calls in flight at once and the service signature checked
# The OutLayer worker refuses a WASM of 10 MB or more, so this fails at
# 10,000,000 bytes or more.
set -eu
cd "$(dirname "$0")"
SIMD='target.wasm32-wasip2.rustflags=["-C","target-feature=+simd128"]'

cargo build --release --target wasm32-wasip2 --locked --offline --config "$SIMD"
cargo build --release --target wasm32-wasip2 --locked --offline --config "$SIMD" \
  --target-dir target/tiny --no-default-features --features tiny
cargo build --release --target wasm32-wasip2 --locked --offline --config "$SIMD" \
  --target-dir target/speaker --no-default-features --features tiny,speaker-service

for WASM in target/wasm32-wasip2/release/voice-probe.wasm target/tiny/wasm32-wasip2/release/voice-probe.wasm \
  target/speaker/wasm32-wasip2/release/voice-probe.wasm; do
  BYTES=$(wc -c < "$WASM" | tr -d ' ')
  echo "$WASM"
  echo "  bytes  $BYTES"
  echo "  sha256 $(shasum -a 256 "$WASM" | cut -d' ' -f1)"
  if [ "$BYTES" -ge 10000000 ]; then
    echo "error: $WASM is at or above 10,000,000 bytes" >&2
    exit 1
  fi
done
