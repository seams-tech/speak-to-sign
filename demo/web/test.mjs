// Checks the Node port against vectors from demo.py (vectors.json, made by
// vectors.py). Run: node --test test.mjs
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import * as s from "./server.mjs";

const v = JSON.parse(fs.readFileSync(new URL("./vectors.json", import.meta.url)));

test("base58 matches demo.py", () => {
  assert.equal(s.b58encode(Buffer.from([0, 0, 1, 2])), v.zeros_b58);
  assert.deepEqual(s.b58decode(v.zeros_b58), Buffer.from([0, 0, 1, 2]));
  assert.equal(s.b58encode(s.b58decode(v.public_b58)), v.public_b58);
});

test("transaction bytes, signature and hash match demo.py", () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "s2s-"));
  const file = path.join(folder, "key.json");
  fs.writeFileSync(file, JSON.stringify({ account_id: "alice.testnet", public_key: `ed25519:${v.public_b58}`,
    private_key: `ed25519:${v.private_b58}` }));
  const key = s.loadOwnerKey(file);
  fs.rmSync(folder, { recursive: true });
  const tx = s.functionCallTx("alice.testnet", key.publicKey, 7, "vault.testnet", Buffer.from([...Array(32).keys()].map((i) => i + 32)),
    "transfer_with_verdict", Buffer.from('{"a":1}'), 50n * 10n ** 12n, 12345n);
  assert.equal(tx.toString("hex"), v.tx_hex);
  assert.equal(s.signedTxBase64(tx, key.privateKey), v.signed);
  assert.equal(s.b58encode(crypto.createHash("sha256").update(tx).digest()), v.tx_hash);
});

test("canonical WAV, enrollment digest, amount and phrase match demo.py", () => {
  const canonical = s.canonicalWav(Buffer.from(v.wav_b64, "base64"));
  assert.equal(crypto.createHash("sha256").update(canonical).digest("hex"), v.canonical_sha256);
  assert.equal(s.enrollmentDigest("v.testnet", "o.testnet", [1, 2, 3].map((n) => Buffer.alloc(32, n))), v.enrollment_digest);
  assert.equal(s.nearToYocto("0.1").toString(), v.yocto);
  assert.throws(() => s.nearToYocto("0.001"));
  assert.equal(s.payPhrase("0.1", "seams-v1.testnet"), v.phrase);
});

test("canonical WAV skips extra chunks and refuses other formats", () => {
  const plain = s.canonicalWav(Buffer.from(v.wav_b64, "base64"));
  const list = Buffer.concat([Buffer.from("LIST"), Buffer.from([4, 0, 0, 0]), Buffer.from("INFO")]);
  const withList = Buffer.concat([plain.subarray(0, 36), list, plain.subarray(36)]);
  withList.writeUInt32LE(withList.length - 8, 4);
  assert.deepEqual(s.canonicalWav(withList), plain);
  const stereo = Buffer.from(plain);
  stereo.writeUInt16LE(2, 22);
  assert.throws(() => s.canonicalWav(stereo), /16 kHz mono/);
});

test("txProgress reads the first receipt and the final status", () => {
  const result = {
    transaction_outcome: { outcome: { receipt_ids: ["r1"] } },
    receipts_outcome: [{ id: "r1", outcome: { status: { SuccessReceiptId: "r2" }, logs: ["a"] } }],
  };
  assert.deepEqual(s.txProgress(result), { accepted: true, settled: false, failures: [], logs: ["a"] });
  result.status = { SuccessValue: "" };
  assert.equal(s.txProgress(result).settled, true);
});
