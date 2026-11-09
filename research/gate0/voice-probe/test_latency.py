"""Unit tests for the pure parts of latency.py. No network.

Run: python3 -I -m unittest discover -s voice-probe -p 'test_latency.py'
"""
import base64
import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import latency  # noqa: E402


class PureParts(unittest.TestCase):
    def test_read_env_value_reads_only_the_name(self):
        with tempfile.NamedTemporaryFile("w", suffix=".env", delete=False) as handle:
            handle.write("# c\nOTHER=x\nexport OUTLAYER_PAYMENT_KEY='a:1:secret'\n")
        try:
            self.assertEqual(latency.read_env_value(handle.name, "OUTLAYER_PAYMENT_KEY"), "a:1:secret")
            self.assertIsNone(latency.read_env_value(handle.name, "MISSING"))
        finally:
            os.remove(handle.name)

    def test_percentile_nearest_rank(self):
        values = list(range(1, 21))
        self.assertEqual(latency.percentile(values, 0.5), 10)
        self.assertEqual(latency.percentile(values, 0.95), 19)
        self.assertEqual(latency.percentile([7], 0.95), 7)
        self.assertIsNone(latency.percentile([], 0.5))

    def test_worker_output_from_string_or_object(self):
        guest = {"ok": True, "ms": {"sign": 1}}
        self.assertEqual(latency.worker_output({"result": {"output": json.dumps(guest)}}), guest)
        self.assertEqual(latency.worker_output({"output": guest, "time_ms": 5}), guest)
        self.assertIsNone(latency.worker_output({"output": "not json"}))
        self.assertEqual(latency.find_key({"a": [{"time_ms": 9}]}, "time_ms"), 9)

    def test_tx_hash(self):
        tx = "8bUYEVR3BUdeLExnBmT7yJAnvLHaK2tUcEo1LqY4c9E3"
        self.assertEqual(latency.parse_tx_hash(f"--- Logs ---\nTransaction ID: {tx}\n"), tx)
        self.assertEqual(latency.parse_tx_hash(f"https://explorer.testnet.near.org/transactions/{tx}"), tx)
        self.assertIsNone(latency.parse_tx_hash("no hash"))

    def test_call_body(self):
        body = latency.call_body(b"RIFF", "send two near", ["alice.testnet"], "abc", {"max_instructions": 1})
        self.assertEqual(body["input"]["op"], "verify_latency")
        self.assertEqual(base64.b64decode(body["input"]["audio_wav_b64"]), b"RIFF")
        self.assertEqual(body["version_key"], "abc")
        self.assertFalse(body["async"])
        self.assertNotIn("version_key", latency.call_body(b"", "", [], None, {}))

    def test_summarize(self):
        records = [{"client_wall_ms": 100 * i, "guest": {"ms": {"sign": i}, "total_ms": i},
                    "chain_receipt_ms": 10, "end_to_receipt_ms": 100 * i + 10} for i in range(1, 21)]
        rows = {name: (n, p50, p95) for name, n, p50, p95, _ in latency.summarize(records)}
        self.assertEqual(rows["client_wall_ms"], (20, 1000, 1900))
        self.assertEqual(rows["guest.sign_ms"], (20, 10, 19))
        self.assertEqual(rows["end_of_speech_to_receipt_ms"], (20, 1010, 1910))
        self.assertNotIn("instructions", rows)

    def test_plan_mode_has_no_side_effects(self):
        self.assertEqual(latency.main([]), 0)


if __name__ == "__main__":
    unittest.main()
