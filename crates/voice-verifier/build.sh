#!/bin/sh
# Builds the OutLayer worker and prints its size and SHA-256.
# The HTTPS design needs a small worker (the 8 MB tract worker cost 8-13 s
# of fixed time), so this fails at 1,000,000 bytes or more.
#
#   ./build.sh           build with the local toolchain
#   ./build.sh --docker  build in the pinned x86_64 Linux image (needs Docker)
#
# The OutLayer version key is the SHA-256 of the WASM, so the build is
# reproducible: one commit gives the same bytes in any folder, on any machine
# of the same host platform. rust-toolchain.toml pins the compiler, Cargo.lock
# pins the crates, ../Cargo.toml makes Cargo hash ../spoken-intent as a
# relative path, and the remaps below replace the local folders that rustc
# writes into panic locations (this checkout, the target folder, CARGO_HOME
# and the toolchain's rust-src) with fixed names. These flags replace any
# RUSTFLAGS of the caller.
#
# Cargo also hashes the host platform into the symbol names of each crate that
# uses a build script or a procedural macro. So macOS and Linux give different
# bytes. The reference platform is x86_64-unknown-linux-gnu: `./build.sh` on
# such a machine, or `./build.sh --docker` on any machine.
set -eu
cd "$(dirname "$0")"
IMAGE=rust:1.97.1-slim-bookworm@sha256:2775a09d208ff0d7c1f50490c45b62db929e87ba1dcbc3f2132ac71a704bcdd3
TARGET_DIR=${CARGO_TARGET_DIR:-target}
mkdir -p "$TARGET_DIR"
TARGET_DIR=$(cd "$TARGET_DIR" && pwd)

report() {
  BYTES=$(wc -c < "$1" | tr -d ' ')
  if command -v sha256sum > /dev/null 2>&1; then
    SHA=$(sha256sum "$1" | cut -d' ' -f1)
  else
    SHA=$(shasum -a 256 "$1" | cut -d' ' -f1)
  fi
  echo "$1"
  echo "host   $2"
  echo "bytes  $BYTES"
  echo "sha256 $SHA"
  if [ "$BYTES" -ge 1000000 ]; then
    echo "error: the WASM is at or above 1,000,000 bytes" >&2
    exit 1
  fi
}

if [ "${1:-}" = "--docker" ]; then
  # The container copies crates/ without the target folders and runs this
  # script on the copy. The WASM comes back in target/docker/.
  OUT=$TARGET_DIR/docker
  mkdir -p "$OUT"
  docker run --rm --platform linux/amd64 \
    -v "$(cd .. && pwd)":/src:ro -v "$OUT":/out -e OWNER="$(id -u):$(id -g)" \
    "$IMAGE" sh -euc '
      mkdir -p /speak-to-sign/crates
      tar -C /src --exclude=target -cf - . | tar -C /speak-to-sign/crates -xf -
      /speak-to-sign/crates/voice-verifier/build.sh >&2
      cp /speak-to-sign/crates/voice-verifier/target/wasm32-wasip2/release/seams-voice-verifier.wasm /out/
      chown "$OWNER" /out/seams-voice-verifier.wasm'
  report "$OUT/seams-voice-verifier.wasm" x86_64-unknown-linux-gnu
  exit 0
fi

COMMIT=$(rustc -vV | sed -n 's/^commit-hash: //p')
HOST=$(rustc -vV | sed -n 's/^host: //p')
US=$(printf '\037')
FLAGS="-Ctarget-feature=+simd128"
# rustc applies the last remap that matches, so a folder inside another one
# comes later. A folder under a symbolic link gets a second remap for its real
# path.
remap() {
  [ -d "$1" ] || return 0
  FLAGS="$FLAGS$US--remap-path-prefix=$1=$2"
  REAL=$(cd "$1" && pwd -P)
  [ "$REAL" = "$1" ] || FLAGS="$FLAGS$US--remap-path-prefix=$REAL=$2"
}
remap "$(cd ../.. && pwd)" /speak-to-sign
remap "$TARGET_DIR" /speak-to-sign/crates/voice-verifier/target
remap "${CARGO_HOME:-$HOME/.cargo}" /cargo
# Without rust-src, rustc writes the standard library paths as /rustc/<commit>.
remap "$(rustc --print sysroot)/lib/rustlib/src/rust" "/rustc/$COMMIT"
unset RUSTFLAGS
CARGO_ENCODED_RUSTFLAGS=$FLAGS cargo build --release --target wasm32-wasip2 --locked \
  --target-dir "$TARGET_DIR"
report "$TARGET_DIR/wasm32-wasip2/release/seams-voice-verifier.wasm" "$HOST"
if [ "$HOST" != x86_64-unknown-linux-gnu ]; then
  echo "note: the reference hash is for x86_64-unknown-linux-gnu; see README.md" >&2
fi
