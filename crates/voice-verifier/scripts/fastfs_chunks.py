"""Write FastFS upload payloads for one file, in the Borsh layout that
outlayer-cli 0.2.1 (src/commands/upload.rs) sends to `__fastdata_fastfs`.

Usage: python3 -I fastfs_chunks.py <file> <out-dir> [extension] [mime-type]
Prints the relative path (<sha256>.<extension>) and one payload file per line.
The default is a WASM (`wasm`, `application/wasm`). For the speaker model of
the `local-speaker` worker: `onnx application/octet-stream`.
"""
import hashlib
import os
import struct
import sys
import time

CHUNK = 1 << 20


def string(value: str) -> bytes:
    data = value.encode()
    return struct.pack("<I", len(data)) + data


def vec(data: bytes) -> bytes:
    return struct.pack("<I", len(data)) + data


def main() -> None:
    path, out_dir = sys.argv[1], sys.argv[2]
    content = open(path, "rb").read()
    digest = hashlib.sha256(content).hexdigest()
    extension = sys.argv[3] if len(sys.argv) > 3 else "wasm"
    mime = sys.argv[4] if len(sys.argv) > 4 else "application/wasm"
    relative = f"{digest}.{extension}"
    os.makedirs(out_dir, exist_ok=True)
    payloads = []
    if len(content) <= CHUNK:
        payloads.append(b"\x00" + string(relative) + b"\x01" + string(mime) + vec(content))
    else:
        nonce = int(time.time()) - 1_769_376_240
        for offset in range(0, len(content), CHUNK):
            chunk = content[offset : offset + CHUNK]
            payloads.append(
                b"\x01"
                + string(relative)
                + struct.pack("<II", offset, len(content))
                + string(mime)
                + vec(chunk)
                + struct.pack("<I", nonce)
            )
    print(relative)
    for index, payload in enumerate(payloads):
        name = os.path.join(out_dir, f"chunk-{index:03d}.bin")
        open(name, "wb").write(payload)
        print(name)


main()
