"""Offline tests of demo.py's pure helpers. Run: python3 demo/test_demo.py"""
import base64
import hashlib
import io
import json
import os
import struct
import sys
import tempfile
import unittest
import wave

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import demo  # noqa: E402

TESTDATA = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "voice-verifier", "testdata")
VECTOR = os.path.join(TESTDATA, "signed_verdict_v1.json")
ENROLLMENT_VECTOR = os.path.join(TESTDATA, "enrollment_digest_v1.json")


def b64u_decode(text):
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def receipt(receipt_id, status, logs=()):
    return {"id": receipt_id, "outcome": {"status": status, "logs": list(logs), "receipt_ids": []}}


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

    def test_b58_round_trip(self):
        for data in (b"", b"\0\0\x01", b"hello world", bytes(range(32))):
            self.assertEqual(demo.b58decode(demo.b58encode(data)), data)
        self.assertEqual(demo.b58encode(b"hello world"), "StV1DL6CwTryKyV")

    def test_shared_enrollment_vector(self):
        with open(ENROLLMENT_VECTOR, encoding="utf-8") as handle:
            vector = json.load(handle)
        self.assertEqual(vector["domain"].encode(), demo.ENROLLMENT_DOMAIN)
        digests = [b64u_decode(text) for text in vector["audio_digests"]]
        self.assertTrue(all(len(digest) == 32 for digest in digests))
        self.assertEqual(demo.enrollment_digest(vector["vault"], vector["owner"], digests),
                         vector["enrollment_digest"])
        self.assertNotEqual(demo.enrollment_digest(vector["vault"], vector["owner"], digests[::-1]),
                            vector["enrollment_digest"])

    def test_canonical_wav(self):
        pcm = struct.pack("<4h", 0, 1000, -1000, 32767)
        buffer = io.BytesIO()
        with wave.open(buffer, "wb") as handle:
            handle.setnchannels(1)
            handle.setsampwidth(2)
            handle.setframerate(16000)
            handle.writeframes(pcm)
        # The verifier's `wav_bytes`: RIFF, fmt (PCM, mono, 16 kHz, 16 bit), data.
        expected = (b"RIFF" + struct.pack("<I", 36 + 8) + b"WAVEfmt " + struct.pack("<I", 16)
                    + struct.pack("<HHIIHH", 1, 1, 16000, 32000, 2, 16) + b"data" + struct.pack("<I", 8) + pcm)
        canonical = demo.canonical_wav(buffer.getvalue())
        self.assertEqual(canonical, expected)
        self.assertEqual(len(canonical), 44 + 8)
        self.assertEqual(demo.canonical_wav(canonical), canonical)

    def test_tx_progress(self):
        tx = {"id": "T", "outcome": {"receipt_ids": ["R1"], "status": {"SuccessReceiptId": "R1"}}}
        # Sent, no receipt yet.
        progress = demo.tx_progress({"final_execution_status": "INCLUDED", "transaction_outcome": tx,
                                     "receipts_outcome": [], "status": "Started"})
        self.assertEqual((progress["accepted"], progress["settled"]), (None, False))
        # The vault call ran; the transfer and the callback did not yet.
        partial = {"transaction_outcome": tx, "status": "Started",
                   "receipts_outcome": [receipt("R1", {"SuccessReceiptId": "R3"}, ["EVENT_JSON:{}"])]}
        progress = demo.tx_progress(partial)
        self.assertEqual((progress["accepted"], progress["settled"]), (True, False))
        self.assertEqual(progress["logs"], ["EVENT_JSON:{}"])
        # Every receipt ran.
        done = dict(partial, status={"SuccessValue": "dHJ1ZQ=="},
                    receipts_outcome=partial["receipts_outcome"] + [receipt("R2", {"SuccessValue": ""}),
                                                                    receipt("R3", {"SuccessValue": "dHJ1ZQ=="})])
        progress = demo.tx_progress(done)
        self.assertEqual((progress["accepted"], progress["settled"], progress["failures"]), (True, True, []))
        # The vault refused (a panic in the first receipt).
        refused = {"transaction_outcome": tx, "status": {"Failure": {"ActionError": {}}},
                   "receipts_outcome": [receipt("R1", {"Failure": {"ActionError": {}}})]}
        progress = demo.tx_progress(refused)
        self.assertEqual((progress["accepted"], progress["settled"]), (False, True))
        self.assertEqual(len(progress["failures"]), 1)

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
