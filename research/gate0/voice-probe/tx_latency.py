"""Time NEAR testnet transactions sent directly over RPC, as a Wallet would.

Usage: python3 -I tx_latency.py <account> <key-file> <runs>

Each run signs a 1 yoctoNEAR self-transfer locally (PyNaCl) and sends it with
`send_tx` and `wait_until: EXECUTED_OPTIMISTIC`, then asks for FINAL. It
prints the time to the executed receipt and to finality. The private key is
read from a near-cli legacy key file and never printed.
"""
import base64
import hashlib
import json
import statistics
import struct
import sys
import time
import urllib.request

import nacl.signing

RPC = "https://test.rpc.fastnear.com"
A = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"


def b58d(text):
    number = 0
    for char in text:
        number = number * 58 + A.index(char)
    raw = number.to_bytes((number.bit_length() + 7) // 8, "big")
    return b"\0" * (len(text) - len(text.lstrip("1"))) + raw


def rpc(method, params, timeout=60):
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode()
    request = urllib.request.Request(RPC, body, {"content-type": "application/json"})
    reply = json.load(urllib.request.urlopen(request, timeout=timeout))
    if "error" in reply:
        raise RuntimeError(json.dumps(reply["error"])[:300])
    return reply["result"]


def string(value):
    data = value.encode()
    return struct.pack("<I", len(data)) + data


def transfer_tx(account, public_key, nonce, block_hash):
    # Borsh Transaction (v0): signer, public key, nonce, receiver, block hash, actions.
    return (
        string(account)
        + b"\x00" + public_key
        + struct.pack("<Q", nonce)
        + string(account)
        + block_hash
        + struct.pack("<I", 1)
        + b"\x03" + (1).to_bytes(16, "little")  # Transfer of 1 yoctoNEAR
    )


def main():
    account, key_file, runs = sys.argv[1], sys.argv[2], int(sys.argv[3])
    key = json.load(open(key_file))
    secret = b58d(key["private_key"].split(":", 1)[1])
    signer = nacl.signing.SigningKey(secret[:32])
    public_key = bytes(signer.verify_key)
    public_text = key["public_key"]
    executed, final = [], []
    for run in range(1, runs + 1):
        access = rpc("query", {"request_type": "view_access_key", "finality": "optimistic",
                               "account_id": account, "public_key": public_text})
        block = rpc("block", {"finality": "final"})
        tx = transfer_tx(account, public_key, access["nonce"] + 1, b58d(block["header"]["hash"]))
        signature = signer.sign(hashlib.sha256(tx).digest()).signature
        signed = base64.b64encode(tx + b"\x00" + signature).decode()
        started = time.time()
        result = rpc("send_tx", {"signed_tx_base64": signed, "wait_until": "EXECUTED_OPTIMISTIC"})
        executed_ms = (time.time() - started) * 1000
        tx_hash = result["transaction"]["hash"]
        rpc("tx", {"tx_hash": tx_hash, "sender_account_id": account, "wait_until": "FINAL"})
        final_ms = (time.time() - started) * 1000
        executed.append(executed_ms)
        final.append(final_ms)
        print(f"run {run:2d}: executed {executed_ms:6.0f} ms, final {final_ms:6.0f} ms, {tx_hash}")
    for name, values in (("executed", executed), ("final", final)):
        ordered = sorted(values)
        p95 = ordered[min(len(ordered) - 1, round(0.95 * (len(ordered) - 1)))]
        print(f"{name}: p50 {statistics.median(values):.0f} ms, p95 {p95:.0f} ms, max {max(values):.0f} ms")


main()
