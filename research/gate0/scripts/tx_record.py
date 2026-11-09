"""Print the Gate 0 record of one testnet transaction: the block height of the
transaction and of each receipt, the OutLayer result log, and the probe
contract's callback record.

Usage: python3 -I tx_record.py <tx-hash> [sender]
"""
import json
import sys
import time
import urllib.request

RPC = "https://test.rpc.fastnear.com"


def rpc(method, params):
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode()
    for attempt in range(6):
        try:
            request = urllib.request.Request(RPC, body, {"content-type": "application/json"})
            reply = json.load(urllib.request.urlopen(request, timeout=30))
            break
        except Exception:  # rate limits and timeouts on the public RPC
            if attempt == 5:
                raise
            time.sleep(2 * (attempt + 1))
    if "error" in reply:
        raise SystemExit(json.dumps(reply["error"])[:500])
    return reply["result"]


heights = {}


def height(block_hash):
    if block_hash not in heights:
        heights[block_hash] = rpc("block", {"block_id": block_hash})["header"]["height"]
    return heights[block_hash]


tx_hash = sys.argv[1]
sender = sys.argv[2] if len(sys.argv) > 2 else "w3a-dev-1766307589.testnet"
status = rpc("EXPERIMENTAL_tx_status", {"tx_hash": tx_hash, "sender_account_id": sender, "wait_until": "FINAL"})
tx_height = height(status["transaction_outcome"]["block_hash"])
record = {"tx": tx_hash, "tx_block": tx_height, "receipts": []}
for outcome in status["receipts_outcome"]:
    entry = {
        "block": height(outcome["block_hash"]),
        "executor": outcome["outcome"]["executor_id"],
        "status": list(outcome["outcome"]["status"].keys())[0],
    }
    logs = [log for log in outcome["outcome"]["logs"] if "Execution" in log or log.startswith("{")]
    if logs:
        entry["logs"] = logs
    if "Failure" in outcome["outcome"]["status"]:
        entry["failure"] = json.dumps(outcome["outcome"]["status"]["Failure"])[:400]
    record["receipts"].append(entry)
callback = [r for r in record["receipts"] if r["executor"].startswith("probe.") and r.get("logs")]
record["last_block"] = max(r["block"] for r in record["receipts"])
record["blocks_tx_to_last"] = record["last_block"] - tx_height
if callback:
    record["callback"] = json.loads(callback[-1]["logs"][-1])
print(json.dumps(record))
