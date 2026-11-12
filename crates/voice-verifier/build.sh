#!/bin/sh
# Builds the OutLayer worker and prints its size and SHA-256.
# The HTTPS design needs a small worker (the 8 MB tract worker cost 8-13 s
# of fixed time), so this fails at 1,000,000 bytes or more.
#
#   ./build.sh           build with the local toolchain
#   ./build.sh --docker  build in the pinned x86_64 Linux image (needs Docker)
#   ./build.sh --local-speaker [--docker]
#                        the variant with ReDimNet inside the worker (the
#                        feature `local-speaker`, with `tract`). It writes
#                        seams-voice-verifier-local-speaker.wasm and fails at
#                        10,000,000 bytes, the limit of the OutLayer worker.
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
#
# After the Rust build, `wasm-opt -Oz` (binaryen) makes the core module about
# 19 % smaller, and `wasm-tools component new` makes the component from it.
# OutLayer loads the module on each call, and the load time grows with the
# size: about 2.2 s for each MB (measured on 2026-11-12). The two tools are
# part of the build, so their versions are pinned below. `--docker` gets them
# from their GitHub releases and checks their SHA-256. A build with the local
# toolchain needs the same versions of `wasm-opt` and `wasm-tools` on the PATH.
set -eu
cd "$(dirname "$0")"
DOCKER=
VARIANT=
for ARG in "$@"; do
  case "$ARG" in
    --docker) DOCKER=1 ;;
    --local-speaker) VARIANT=local-speaker ;;
    *) echo "error: unknown argument $ARG" >&2; exit 2 ;;
  esac
done
# The default variant shares no target folder with the other one, so one
# build does not replace the WASM of the other.
if [ -n "$VARIANT" ]; then
  NAME=seams-voice-verifier-$VARIANT
  LIMIT=10000000
  SUBDIR=/$VARIANT
else
  NAME=seams-voice-verifier
  LIMIT=1000000
  SUBDIR=
fi
IMAGE=rust:1.97.1-slim-bookworm@sha256:2775a09d208ff0d7c1f50490c45b62db929e87ba1dcbc3f2132ac71a704bcdd3
BINARYEN_VERSION=133
BINARYEN_TAR=binaryen-version_$BINARYEN_VERSION-x86_64-linux.tar.gz
BINARYEN_URL=https://github.com/WebAssembly/binaryen/releases/download/version_$BINARYEN_VERSION/$BINARYEN_TAR
BINARYEN_SHA256=2dc9c7813f5375db93d96ead4b78222fcc3e2677bbb832297af4797782a37489
WASM_TOOLS_VERSION=1.263.0
WASM_TOOLS_TAR=wasm-tools-$WASM_TOOLS_VERSION-x86_64-linux.tar.gz
WASM_TOOLS_URL=https://github.com/bytecodealliance/wasm-tools/releases/download/v$WASM_TOOLS_VERSION/$WASM_TOOLS_TAR
WASM_TOOLS_SHA256=21c036c1740a0552124c79c6e2170cb61c5b016005671a6d5bc06cf642165431
# The WebAssembly features of the Rust build: the defaults of wasm32-wasip2
# and simd128. wasm-opt uses no other feature.
WASM_FEATURES="--enable-bulk-memory --enable-bulk-memory-opt --enable-call-indirect-overlong
  --enable-multivalue --enable-mutable-globals --enable-nontrapping-float-to-int
  --enable-reference-types --enable-sign-ext --enable-simd"
TARGET_DIR=${CARGO_TARGET_DIR:-target}
mkdir -p "$TARGET_DIR"
TARGET_DIR=$(cd "$TARGET_DIR" && pwd)

sha256() {
  if command -v sha256sum > /dev/null 2>&1; then
    sha256sum "$1" | cut -d' ' -f1
  else
    shasum -a 256 "$1" | cut -d' ' -f1
  fi
}

report() {
  BYTES=$(wc -c < "$1" | tr -d ' ')
  SHA=$(sha256 "$1")
  echo "$1"
  echo "host   $2"
  echo "bytes  $BYTES"
  echo "sha256 $SHA"
  if [ "$BYTES" -ge "$LIMIT" ]; then
    echo "error: the WASM is at or above $LIMIT bytes" >&2
    exit 1
  fi
}

# Downloads a pinned tool archive into target/tools/, once, and checks its
# SHA-256 on each build.
fetch() {
  [ -f "$TOOLS/$1" ] || curl -sfL -o "$TOOLS/$1" "$2"
  if [ "$(sha256 "$TOOLS/$1")" != "$3" ]; then
    echo "error: $TOOLS/$1 does not have the SHA-256 $3" >&2
    exit 1
  fi
}

if [ -n "$DOCKER" ]; then
  # The container copies crates/ without the target folders and runs this
  # script on the copy, with the two pinned tools on its PATH. The WASM comes
  # back in target/docker/.
  OUT=$TARGET_DIR/docker
  TOOLS=$TARGET_DIR/tools
  mkdir -p "$OUT" "$TOOLS"
  fetch "$BINARYEN_TAR" "$BINARYEN_URL" "$BINARYEN_SHA256"
  fetch "$WASM_TOOLS_TAR" "$WASM_TOOLS_URL" "$WASM_TOOLS_SHA256"
  docker run --rm --platform linux/amd64 \
    -v "$(cd .. && pwd)":/src:ro -v "$TOOLS":/tools:ro -v "$OUT":/out -e OWNER="$(id -u):$(id -g)" \
    -e VARIANT="$VARIANT" -e NAME="$NAME" \
    -e BINARYEN_TAR="$BINARYEN_TAR" -e WASM_TOOLS_TAR="$WASM_TOOLS_TAR" \
    "$IMAGE" sh -euc '
      mkdir -p /speak-to-sign/crates /opt/bin
      tar -C /opt/bin -xzf "/tools/$BINARYEN_TAR" --strip-components=2 --wildcards "*/bin/wasm-opt"
      tar -C /opt/bin -xzf "/tools/$WASM_TOOLS_TAR" --strip-components=1 --wildcards "*/wasm-tools"
      tar -C /src --exclude=target -cf - . | tar -C /speak-to-sign/crates -xf -
      PATH=/opt/bin:$PATH /speak-to-sign/crates/voice-verifier/build.sh ${VARIANT:+--$VARIANT} >&2
      cp "/speak-to-sign/crates/voice-verifier/target/worker/$NAME.wasm" /out/
      chown "$OWNER" "/out/$NAME.wasm"'
  report "$OUT/$NAME.wasm" x86_64-unknown-linux-gnu
  exit 0
fi

# The tools are part of the build: another version gives other bytes.
need() {
  FOUND=$("$1" --version 2> /dev/null || true)
  case "$FOUND" in
    "$2" | "$2 "*) ;;
    *)
      echo "error: this build needs $3 on the PATH (found: ${FOUND:-none}); or use ./build.sh --docker" >&2
      exit 1
      ;;
  esac
}
need wasm-opt "wasm-opt version $BINARYEN_VERSION" "wasm-opt of binaryen $BINARYEN_VERSION"
need wasm-tools "wasm-tools $WASM_TOOLS_VERSION" "wasm-tools $WASM_TOOLS_VERSION"

COMMIT=$(rustc -vV | sed -n 's/^commit-hash: //p')
HOST=$(rustc -vV | sed -n 's/^host: //p')
US=$(printf '\037')
# The linker stops at the core module, so that wasm-opt can read it.
FLAGS="-Ctarget-feature=+simd128$US-Clink-arg=--skip-wit-component"
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
  --target-dir "$TARGET_DIR$SUBDIR" ${VARIANT:+--features "$VARIANT"}
# Cargo owns its own output file, so the worker goes into target/worker/.
CORE=$TARGET_DIR$SUBDIR/wasm32-wasip2/release/seams-voice-verifier.wasm
WORKER=$TARGET_DIR/worker
mkdir -p "$WORKER"
# shellcheck disable=SC2086
wasm-opt -Oz $WASM_FEATURES "$CORE" -o "$WORKER/$NAME.core.wasm"
wasm-tools component new "$WORKER/$NAME.core.wasm" -o "$WORKER/$NAME.wasm"
rm "$WORKER/$NAME.core.wasm"
report "$WORKER/$NAME.wasm" "$HOST"
if [ "$HOST" != x86_64-unknown-linux-gnu ]; then
  echo "note: the reference hash is for x86_64-unknown-linux-gnu; see README.md" >&2
fi
