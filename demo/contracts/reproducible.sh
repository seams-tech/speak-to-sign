#!/usr/bin/env bash
# Builds the demo contracts byte for byte the same on any computer, and checks
# a recorded build. It needs Docker, git and cargo-near 0.22.0 (`cargo near`).
#
#   ./reproducible.sh build [contract ...]  build the committed HEAD; write
#                                           <contract>/res/<name>.wasm and
#                                           <contract>/reproducible.sha256
#   ./reproducible.sh check [contract ...]  build the commit that
#                                           <contract>/reproducible.sha256
#                                           names again, and compare the SHA-256
#
# With no contract name, the script does all four contracts.
#
# `cargo near build reproducible-wasm` (NEP-330) builds the contract in the
# Docker image that `[package.metadata.near.reproducible_build]` in its
# Cargo.toml pins by digest. It writes the image, the build command, the
# repository and the commit into the contract metadata
# (`contract_source_metadata`). So NearBlocks can build the deployed code again
# and compare its hash. The commit is part of the WASM: two commits give two
# hashes, also when the contract source is the same.
#
# The build uses a fresh clone of the commit, so files that are not committed
# do not change it. (cargo-near reads the main checkout of a git worktree, not
# the worktree, so a clone is also necessary in a worktree.)
set -euo pipefail
cd "$(dirname "$0")"
ROOT=$(git rev-parse --show-toplevel)
ALL=(community-notes faucet jev-prediction-market voice-multisig)
CARGO_NEAR_VERSION=0.22.0

usage() {
  sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//' >&2
  exit 2
}

[ $# -ge 1 ] || usage
MODE=$1
shift
case "$MODE" in build | check) ;; *) usage ;; esac
if [ $# -gt 0 ]; then CONTRACTS=("$@"); else CONTRACTS=("${ALL[@]}"); fi
for C in "${CONTRACTS[@]}"; do
  [ -f "$C/Cargo.toml" ] || { echo "error: no contract $C" >&2; exit 2; }
done

if ! cargo near --version 2> /dev/null | grep -q " $CARGO_NEAR_VERSION\$"; then
  echo "note: this script was checked with cargo-near $CARGO_NEAR_VERSION; found: $(cargo near --version 2>&1 | head -1)" >&2
fi

sha256() {
  if command -v sha256sum > /dev/null 2>&1; then
    sha256sum "$1" | cut -d ' ' -f 1
  else
    shasum -a 256 "$1" | cut -d ' ' -f 1
  fi
}

# The WASM file name of a contract: its package name with '_' for '-'.
wasm_name() {
  sed -n 's/^name = "\(.*\)"/\1/p' "$1/Cargo.toml" | head -1 | tr - _
}

# The folders and files whose change changes the WASM of a contract: the
# contract folder without its docs, scripts and test crates, and each path
# dependency.
sources() {
  echo "demo/contracts/$1"
  echo ":(exclude)demo/contracts/$1/*.md"
  echo ":(exclude)demo/contracts/$1/*.sh"
  echo ":(exclude)demo/contracts/$1/reproducible.sha256"
  echo ":(exclude)demo/contracts/$1/sandbox"
  echo ":(exclude)demo/contracts/$1/resolver"
  sed -n 's/.*path = "\(\.\.\/[^"]*\)".*/\1/p' "$1/Cargo.toml" | while read -r DEP; do
    (cd "$1/$DEP" && git rev-parse --show-prefix | sed 's:/$::')
  done
}

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

# build_commit <contract> <commit> <out dir>: builds the contract of the commit
# in a fresh clone and copies the WASM to the out folder.
build_commit() {
  local C=$1 REV=$2 OUT=$3 SRC
  SRC=$TMP/$REV/speak-to-sign
  if ! git cat-file -e "$REV^{commit}" 2> /dev/null; then
    echo "error: commit $REV is not in this clone; fetch the full history" >&2
    exit 1
  fi
  if [ ! -d "$SRC" ]; then
    # --shared reads the objects of this repository, so any commit of it works.
    git clone --quiet --shared --no-checkout "$(git rev-parse --path-format=absolute --git-common-dir)" "$SRC"
    git -C "$SRC" -c advice.detachedHead=false checkout --quiet --detach "$REV"
  fi
  (cd "$SRC/demo/contracts/$C" && cargo near build reproducible-wasm --out-dir "$OUT")
}

STATUS=0
for C in "${CONTRACTS[@]}"; do
  NAME=$(wasm_name "$C")
  RECORD=$C/reproducible.sha256
  if [ "$MODE" = build ]; then
    REV=$(git rev-parse HEAD)
    SOURCES=()
    while IFS= read -r LINE; do SOURCES+=("$LINE"); done < <(sources "$C")
    if [ -n "$(git -C "$ROOT" status --porcelain -- "${SOURCES[@]}")" ]; then
      echo "error: $C has changes that are not committed; the build uses the committed HEAD" >&2
      exit 1
    fi
    echo "== $C: build of commit $REV" >&2
    build_commit "$C" "$REV" "$TMP/out-$C" >&2
    mkdir -p "$C/res"
    cp "$TMP/out-$C/$NAME.wasm" "$C/res/$NAME.wasm"
    SHA=$(sha256 "$C/res/$NAME.wasm")
    BYTES=$(wc -c < "$C/res/$NAME.wasm" | tr -d ' ')
    {
      echo "# cargo near build reproducible-wasm of commit $REV ($BYTES bytes)."
      echo "# Check it with ../reproducible.sh check $C"
      echo "$SHA  res/$NAME.wasm"
    } > "$RECORD"
    echo "$C/res/$NAME.wasm"
    echo "commit  $REV"
    echo "bytes   $BYTES"
    echo "sha256  $SHA"
  else
    [ -f "$RECORD" ] || { echo "error: no $RECORD; run ./reproducible.sh build $C" >&2; exit 1; }
    REV=$(sed -n 's/^# cargo near build reproducible-wasm of commit \([0-9a-f]\{40\}\).*/\1/p' "$RECORD")
    WANT=$(grep -v '^#' "$RECORD" | cut -d ' ' -f 1)
    [ -n "$REV" ] && [ -n "$WANT" ] || { echo "error: $RECORD has no commit or no SHA-256" >&2; exit 1; }
    echo "== $C: build of commit $REV again" >&2
    build_commit "$C" "$REV" "$TMP/out-$C" >&2
    GOT=$(sha256 "$TMP/out-$C/$NAME.wasm")
    echo "$C"
    echo "commit    $REV"
    echo "recorded  $WANT"
    echo "built     $GOT"
    if [ "$GOT" = "$WANT" ]; then
      echo "result    same bytes"
    else
      echo "result    DIFFERENT bytes" >&2
      STATUS=1
    fi
    SOURCES=()
    while IFS= read -r LINE; do SOURCES+=("$LINE"); done < <(sources "$C")
    if ! git -C "$ROOT" diff --quiet "$REV" HEAD -- "${SOURCES[@]}"; then
      NOTE="the source of $C changed after commit $REV. Run ./reproducible.sh build $C for a new record."
      # In GitHub Actions, the note is a warning on the run page.
      if [ -n "${GITHUB_ACTIONS:-}" ]; then echo "::warning::$NOTE"; else echo "note: $NOTE" >&2; fi
    fi
  fi
done
exit $STATUS
