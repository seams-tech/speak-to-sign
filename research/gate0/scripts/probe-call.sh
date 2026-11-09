#!/bin/bash
# Call the Gate 0 probe contract once and print what OutLayer logged and what
# the contract callback received.
# Usage: probe-call.sh '<input json>' [version_key|null] [deposit NEAR] [max_instructions] [max_seconds] [max_memory_mb]
set -u
INPUT=$1
VERSION=${2:-null}
DEPOSIT=${3:-0.02}
INSTR=${4:-1000000000}
SECS=${5:-60}
MEM=${6:-128}
if [ "$VERSION" != null ]; then VERSION="\"$VERSION\""; fi
ARGS=$(python3 -I -c 'import json,sys; print(json.dumps({"input": sys.argv[1], "version_key": json.loads(sys.argv[2]), "max_instructions": int(sys.argv[3]), "max_seconds": int(sys.argv[4]), "max_memory_mb": int(sys.argv[5])}))' "$INPUT" "$VERSION" "$INSTR" "$SECS" "$MEM")
near contract call-function as-transaction probe.w3a-dev-1766307589.testnet probe json-args "$ARGS" \
  prepaid-gas '300 Tgas' attached-deposit "$DEPOSIT NEAR" sign-as w3a-dev-1766307589.testnet \
  network-config testnet sign-with-legacy-keychain send 2>&1 \
  | grep -E 'Execution completed|Execution failed|Logs \[probe|Transaction ID|Error|panicked|Smart contract' \
  | grep -v 'No logs' | sed 's/^[│ ]*//' | cut -c1-1200
