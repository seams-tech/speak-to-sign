#!/usr/bin/env python3
"""Prints reference vectors from demo.py for test.mjs (run: python3 vectors.py)."""
import base64
import hashlib
import io
import json
import os
import sys
import wave

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import demo  # noqa: E402
import nacl.signing  # noqa: E402

seed = bytes(range(32))
signer = nacl.signing.SigningKey(seed)
public_key = bytes(signer.verify_key)
tx = demo.function_call_tx("alice.testnet", public_key, 7, "vault.testnet", bytes(range(32, 64)),
                           "transfer_with_verdict", b'{"a":1}', demo.TRANSFER_GAS, 12345)
buffer = io.BytesIO()
with wave.open(buffer, "wb") as handle:
    handle.setnchannels(1)
    handle.setsampwidth(2)
    handle.setframerate(16000)
    handle.writeframes(bytes(range(200)))
print(json.dumps({
    "private_b58": demo.b58encode(seed + public_key),
    "public_b58": demo.b58encode(public_key),
    "zeros_b58": demo.b58encode(b"\0\0\x01\x02"),
    "tx_hex": tx.hex(),
    "signed": demo.signed_tx_base64(tx, signer),
    "tx_hash": demo.b58encode(hashlib.sha256(tx).digest()),
    "wav_b64": base64.b64encode(buffer.getvalue()).decode(),
    "canonical_sha256": hashlib.sha256(demo.canonical_wav(buffer.getvalue())).hexdigest(),
    "enrollment_digest": demo.enrollment_digest("v.testnet", "o.testnet", [b"\1" * 32, b"\2" * 32, b"\3" * 32]),
    "yocto": str(demo.near_to_yocto("0.1")),
    "phrase": demo.pay_phrase("0.1", "seams-v1.testnet"),
}, indent=1))
