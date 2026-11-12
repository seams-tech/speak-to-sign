#!/bin/sh
# Builds the OutLayer worker of the pm-notes market and prints its size and
# SHA-256. The SHA-256 is the OutLayer version key.
#
#   ./build.sh           build with the local toolchain
#   ./build.sh --docker  build in the pinned x86_64 Linux image (needs Docker)
#   ./build.sh --record  build as --docker, and write reproducible.sha256
#   ./build.sh --check   build as --docker, and compare the SHA-256 with
#                        reproducible.sha256
#
# Each build writes res/pm-notes-resolver.wasm.
#
# The build is reproducible: one source gives the same bytes in any folder, on
# any machine of the same host platform. rust-toolchain.toml pins the compiler
# (Rust 1.97.1 with wasm32-wasip2), Cargo.lock pins the crates, and the remaps
# below replace the local folders that rustc writes into panic locations (this
# checkout, the target folder, CARGO_HOME and the toolchain's rust-src) with
# fixed names. These flags replace any RUSTFLAGS of the caller.
#
# Cargo hashes the host platform into the symbol names of each crate that uses
# a build script or a procedural macro (serde is one). So macOS and Linux give
# different bytes. The reference platform is x86_64-unknown-linux-gnu:
# `./build.sh` on such a machine, or `./build.sh --docker` on any machine.
# Deploy the WASM of `./build.sh --docker`, so that its version key can be
# built again.
set -eu
cd "$(dirname "$0")"
MODE=local
for ARG in "$@"; do
  case "$ARG" in
    --docker) MODE=docker ;;
    --record) MODE=record ;;
    --check) MODE=check ;;
    *) echo "error: unknown argument $ARG" >&2; exit 2 ;;
  esac
done
NAME=pm-notes-resolver
IMAGE=rust:1.97.1-slim-bookworm@sha256:2775a09d208ff0d7c1f50490c45b62db929e87ba1dcbc3f2132ac71a704bcdd3
# The folder of this crate in a clone, and in the container.
CRATE=demo/contracts/jev-prediction-market/resolver
RECORD=reproducible.sha256

sha256() {
  if command -v sha256sum > /dev/null 2>&1; then
    sha256sum "$1" | cut -d' ' -f1
  else
    shasum -a 256 "$1" | cut -d' ' -f1
  fi
}

report() {
  BYTES=$(wc -c < "res/$NAME.wasm" | tr -d ' ')
  SHA=$(sha256 "res/$NAME.wasm")
  echo "res/$NAME.wasm"
  echo "host   $1"
  echo "bytes  $BYTES"
  echo "sha256 $SHA"
}

if [ "$MODE" != local ]; then
  # The container copies this folder without target/ and res/, and runs this
  # script on the copy.
  mkdir -p res
  docker run --rm --platform linux/amd64 \
    -v "$(pwd)":/src:ro -v "$(pwd)/res":/out -e OWNER="$(id -u):$(id -g)" \
    -e CRATE="$CRATE" -e NAME="$NAME" \
    "$IMAGE" sh -euc '
      mkdir -p "/speak-to-sign/$CRATE"
      tar -C /src --exclude=./target --exclude=./res -cf - . | tar -C "/speak-to-sign/$CRATE" -xf -
      "/speak-to-sign/$CRATE/build.sh" >&2
      cp "/speak-to-sign/$CRATE/res/$NAME.wasm" /out/
      chown "$OWNER" "/out/$NAME.wasm"'
  report x86_64-unknown-linux-gnu
  case "$MODE" in
    record)
      {
        echo "# ./build.sh --docker ($BYTES bytes, host x86_64-unknown-linux-gnu)."
        echo "# Check it with ./build.sh --check"
        echo "$SHA  res/$NAME.wasm"
      } > "$RECORD"
      echo "wrote $RECORD"
      ;;
    check)
      WANT=$(grep -v '^#' "$RECORD" | cut -d' ' -f1)
      echo "recorded $WANT"
      if [ "$SHA" = "$WANT" ]; then
        echo "result   same bytes"
      else
        echo "result   DIFFERENT bytes" >&2
        exit 1
      fi
      ;;
  esac
  exit 0
fi

COMMIT=$(rustc -vV | sed -n 's/^commit-hash: //p')
HOST=$(rustc -vV | sed -n 's/^host: //p')
TARGET_DIR=${CARGO_TARGET_DIR:-target}
mkdir -p "$TARGET_DIR"
TARGET_DIR=$(cd "$TARGET_DIR" && pwd)
US=$(printf '\037')
FLAGS=
# rustc applies the last remap that matches, so a folder inside another one
# comes later. A folder under a symbolic link gets a second remap for its real
# path.
remap() {
  [ -d "$1" ] || return 0
  FLAGS="$FLAGS${FLAGS:+$US}--remap-path-prefix=$1=$2"
  REAL=$(cd "$1" && pwd -P)
  [ "$REAL" = "$1" ] || FLAGS="$FLAGS$US--remap-path-prefix=$REAL=$2"
}
remap "$(pwd)" "/speak-to-sign/$CRATE"
remap "$TARGET_DIR" "/speak-to-sign/$CRATE/target"
remap "${CARGO_HOME:-$HOME/.cargo}" /cargo
# Without rust-src, rustc writes the standard library paths as /rustc/<commit>.
remap "$(rustc --print sysroot)/lib/rustlib/src/rust" "/rustc/$COMMIT"
unset RUSTFLAGS
CARGO_ENCODED_RUSTFLAGS=$FLAGS cargo build --release --target wasm32-wasip2 --locked \
  --target-dir "$TARGET_DIR"
mkdir -p res
cp "$TARGET_DIR/wasm32-wasip2/release/$NAME.wasm" "res/$NAME.wasm"
report "$HOST"
if [ "$HOST" != x86_64-unknown-linux-gnu ]; then
  echo "note: the reference hash is for x86_64-unknown-linux-gnu; use ./build.sh --docker" >&2
fi
