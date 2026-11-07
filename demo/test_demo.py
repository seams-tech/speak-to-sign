"""Offline tests of demo.py's pure helpers. Run: python3 demo/test_demo.py"""
import base64
import hashlib
import json
import os
import struct
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import demo  # noqa: E402

VECTOR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "voice-verifier", "testdata",
                      "signed_verdict_v1.json")


class Helpers(unittest.TestCase):
    def test_amounts(self):
        self.assertEqual(demo.near_to_yocto("2"), 2 * 10 ** 24)
        self.assertEqual(demo.near_to_yocto("0.5"), 5 * 10 ** 23)
        self.assertEqual(demo.near_to_yocto("0.01"), 10 ** 22)
        for bad in ("0", "-1", "0.001", "abc", "1e-3"):
            with self.assertRaises(ValueError):
                demo.near_to_yocto(bad)

    def test_phrase(self):
        self.assertEqual(demo.pay_phrase("2", "alice.testnet"), "Send 2 NEAR to alice dot testnet.")
        self.assertEqual(demo.spoken_account("bob-1_x.testnet"), "bob dash 1 underscore x dot testnet")

    def test_env_file_reads_one_name(self):
        with tempfile.NamedTemporaryFile("w", suffix=".env", delete=False) as handle:
            handle.write("# c\nOTHER=1\nexport OUTLAYER_PAYMENT_KEY='abc'\n")
        try:
            self.assertEqual(demo.read_env_value(handle.name, "OUTLAYER_PAYMENT_KEY"), "abc")
            self.assertIsNone(demo.read_env_value(handle.name, "MISSING"))
        finally:
            os.remove(handle.name)

    def test_b58(self):
        self.assertEqual(demo.b58decode("112"), b"\0\0\x01")
        self.assertEqual(demo.b58decode("StV1DL6CwTryKyV"), b"hello world")

    def test_output_in_string_form(self):
        reply = {"result": {"output": json.dumps({"kind": "x"}), "time_ms": 5}}
        self.assertEqual(demo.worker_output(reply), {"kind": "x"})
        self.assertEqual(demo.find_key(reply, "time_ms"), 5)

    def test_shared_vector_message_and_signature(self):
        with open(VECTOR, encoding="utf-8") as handle:
            vector = json.load(handle)
        message = demo.verdict_message(vector["verdict_json"])
        self.assertEqual(message.hex(), vector["message_sha256_hex"])
        import nacl.signing
        key = nacl.signing.VerifyKey(demo.b58decode(vector["public_key"].split(":", 1)[1]))
        key.verify(message, base64.b64decode(vector["signature_b64"]))
        self.assertEqual(bytes(key).hex(), vector["public_key_hex"])

    def test_function_call_layout(self):
        public_key = bytes(range(32))
        block_hash = bytes([7]) * 32
        tx = demo.function_call_tx("o.testnet", public_key, 5, "v.testnet", block_hash, "m", b"{}", 30, 1)
        expected = (struct.pack("<I", 9) + b"o.testnet" + b"\x00" + public_key + struct.pack("<Q", 5)
                    + struct.pack("<I", 9) + b"v.testnet" + block_hash + struct.pack("<I", 1)
                    + b"\x02" + struct.pack("<I", 1) + b"m" + struct.pack("<I", 2) + b"{}"
                    + struct.pack("<Q", 30) + (1).to_bytes(16, "little"))
        self.assertEqual(tx, expected)
        import nacl.signing
        signer = nacl.signing.SigningKey(bytes(32))
        signed = base64.b64decode(demo.signed_tx_base64(tx, signer))
        self.assertEqual(signed[:len(tx)], tx)
        self.assertEqual(signed[len(tx)], 0)
        signer.verify_key.verify(hashlib.sha256(tx).digest(), signed[len(tx) + 1:])


if __name__ == "__main__":
    unittest.main()
